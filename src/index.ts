import type { Plugin } from "@opencode-ai/plugin";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "./config/loader";
import { buildReadinessReport } from "./config/readiness";
import { createBuiltinMcps } from "./mcp";
import { buildTaskPlaybook, hasPlaybookMarker } from "./orchestration/playbook";
import { decideAutoDispatch, isNonOverridableSubagent } from "./orchestration/task-dispatch";
import { route } from "./orchestration/router";
import { agentModel } from "./orchestration/model-health";
import { loadScopePolicyFromWorkspace } from "./bounty/scope-policy";
import type { BountyScopePolicy, ScopeDocLoadResult } from "./bounty/scope-policy";
import { evaluateBashCommand, extractBashCommand } from "./risk/policy-matrix";
import {
  isTokenOrQuotaFailure,
  classifyFailureReason,
  detectInjectionIndicators,
  isContextLengthFailure,
  isLikelyTimeout,
  isRetryableTaskFailure,
  isVerifyFailure,
  isVerificationSourceRelevant,
  isVerifySuccess,
} from "./risk/sanitize";
import { NotesStore } from "./state/notes-store";
import { SessionStore } from "./state/session-store";
import type { TargetType } from "./state/types";
import { createControlTools } from "./tools/control-tools";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class AegisPolicyDenyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AegisPolicyDenyError";
  }
}

function normalizeToolName(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 64);
}

function isPathInsideRoot(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, resolvedPath);
  if (!rel) return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function truncateWithHeadTail(text: string, headChars: number, tailChars: number): string {
  const safeHead = Math.max(0, Math.floor(headChars));
  const safeTail = Math.max(0, Math.floor(tailChars));
  if (text.length <= safeHead + safeTail + 64) {
    return text;
  }
  const head = text.slice(0, safeHead);
  const tail = safeTail > 0 ? text.slice(-safeTail) : "";
  return `${head}\n\n... [truncated] ...\n\n${tail}`;
}

function inProgressTodoCount(args: unknown): number {
  if (!isRecord(args)) {
    return 0;
  }
  const candidate = args.todos;
  if (!Array.isArray(candidate)) {
    return 0;
  }
  let count = 0;
  for (const todo of candidate) {
    if (!isRecord(todo)) {
      continue;
    }
    if (todo.status === "in_progress") {
      count += 1;
    }
  }
  return count;
}

function textFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const data = part as Record<string, unknown>;
      if (data.type !== "text") {
        return "";
      }
      return typeof data.text === "string" ? data.text : "";
    })
    .join("\n")
    .trim();
}

function textFromUnknown(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const data = value as Record<string, unknown>;
  const chunks: string[] = [];
  const keys = ["text", "content", "prompt", "input", "message", "query", "goal", "description"];

  for (const key of keys) {
    const item = data[key];
    if (typeof item === "string" && item.trim().length > 0) {
      chunks.push(item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const nested = item as Record<string, unknown>;
    if (typeof nested.text === "string" && nested.text.trim().length > 0) {
      chunks.push(nested.text);
    }
    if (typeof nested.content === "string" && nested.content.trim().length > 0) {
      chunks.push(nested.content);
    }
  }

  return chunks.join("\n");
}

function detectTargetType(text: string): TargetType | null {
  const lower = text.toLowerCase();
  if (
    /(\bweb3\b|smart contract|solidity|evm|ethereum|foundry|hardhat|slither|reentrancy|erc20|defi|onchain|bridge)/i.test(
      lower
    )
  ) {
    return "WEB3";
  }
  if (/(\bweb\b|\bapi\b|http|graphql|rest|websocket|grpc|idor|xss|sqli)/i.test(lower)) return "WEB_API";
  if (/(\bpwn\b|heap|rop|shellcode|gdb|pwntools|format string|use-after-free)/i.test(lower)) return "PWN";
  if (/(\brev\b|reverse|decompile|ghidra|ida|radare|disasm|elf|packer)/i.test(lower)) return "REV";
  if (/(\bcrypto\b|cipher|rsa|aes|hash|ecc|curve|lattice|padding oracle)/i.test(lower)) return "CRYPTO";
  if (
    /(\bforensics\b|pcap|pcapng|disk image|memory dump|volatility|wireshark|evtx|mft|registry hive|timeline|carv)/i.test(
      lower
    )
  ) {
    return "FORENSICS";
  }
  if (/(\bmisc\b|steg|osint|encoding|puzzle|logic)/i.test(lower)) return "MISC";
  return null;
}

  const OhMyAegisPlugin: Plugin = async (ctx) => {
    const config = loadConfig(ctx.directory);
    const notesStore = new NotesStore(ctx.directory, config.markdown_budget, config.notes.root_dir);
  let notesReady = true;

  const softBashOverrideByCallId = new Map<string, { addedAt: number; reason: string; command: string }>();
  const SOFT_BASH_OVERRIDE_TTL_MS = 10 * 60_000;
  const pruneSoftBashOverrides = (): void => {
    const now = Date.now();
    for (const [callId, entry] of softBashOverrideByCallId.entries()) {
      if (now - entry.addedAt > SOFT_BASH_OVERRIDE_TTL_MS) {
        softBashOverrideByCallId.delete(callId);
      }
    }
    if (softBashOverrideByCallId.size <= 200) {
      return;
    }
    const entries = [...softBashOverrideByCallId.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
    for (let i = 0; i < entries.length - 200; i += 1) {
      softBashOverrideByCallId.delete(entries[i][0]);
    }
  };

  const readContextByCallId = new Map<string, { sessionID: string; filePath: string }>();
  const injectedContextPathsBySession = new Map<string, Set<string>>();
  const injectedContextPathsFor = (sessionID: string): Set<string> => {
    const existing = injectedContextPathsBySession.get(sessionID);
    if (existing) return existing;
    const created = new Set<string>();
    injectedContextPathsBySession.set(sessionID, created);
    return created;
  };

  const writeToolOutputArtifact = (params: {
    sessionID: string;
    tool: string;
    callID: string;
    title: string;
    output: string;
  }): string | null => {
    try {
      if (!notesReady) {
        return null;
      }
      const root = notesStore.getRootDirectory();
      const base = join(root, "artifacts", "tool-output", params.sessionID);
      mkdirSync(base, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${stamp}_${normalizeToolName(params.tool)}_${normalizeToolName(params.callID)}.txt`;
      const path = join(base, fileName);
      const header = [
        `TITLE: ${params.title}`,
        `TOOL: ${params.tool}`,
        `SESSION: ${params.sessionID}`,
        `CALL: ${params.callID}`,
        "---",
        "",
      ].join("\n");
      writeFileSync(path, `${header}${params.output}\n`, "utf-8");
      return path;
    } catch {
      return null;
    }
  };

  const scopePolicyCache: {
    lastLoadAt: number;
    sourcePath: string | null;
    sourceMtimeMs: number;
    result: ScopeDocLoadResult;
  } = {
    lastLoadAt: 0,
    sourcePath: null,
    sourceMtimeMs: 0,
    result: { ok: false, reason: "not_loaded", warnings: [] },
  };
  const safeNoteWrite = (label: string, action: () => void): void => {
    if (!notesReady) {
      return;
    }
    try {
      action();
    } catch {
      notesReady = false;
    }
  };
  const noteHookError = (label: string, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    safeNoteWrite(label, () => {
      notesStore.recordScan(`hook-error ${label}: ${message}`);
    });
  };
  try {
    notesStore.ensureFiles();
  } catch {
    notesReady = false;
  }

  const maybeAutoloopTick = async (sessionID: string, trigger: string): Promise<void> => {
    if (!config.auto_loop.enabled) {
      return;
    }
    const state = store.get(sessionID);
    if (!state.autoLoopEnabled) {
      return;
    }
    if (config.auto_loop.only_when_ultrawork && !state.ultraworkEnabled) {
      return;
    }
    if (config.auto_loop.stop_on_verified && state.mode === "CTF" && state.latestVerified.trim().length > 0) {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.stop", () => {
        notesStore.recordScan("Auto loop stopped: verified output present.");
      });
      return;
    }

    const now = Date.now();
    if (state.autoLoopLastPromptAt > 0 && now - state.autoLoopLastPromptAt < config.auto_loop.idle_delay_ms) {
      return;
    }

    if (state.autoLoopIterations >= config.auto_loop.max_iterations) {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.stop", () => {
        notesStore.recordScan(
          `Auto loop stopped: max iterations reached (${config.auto_loop.max_iterations}).`
        );
      });
      return;
    }

    const decision = route(state, config);
    const iteration = state.autoLoopIterations + 1;
    const promptText = [
      "[oh-my-Aegis auto-loop]",
      `trigger=${trigger} iteration=${iteration}`,
      `next_route=${decision.primary}`,
      "Rules:",
      "- Do exactly 1 TODO (create/update with todowrite).",
      "- Execute via the next_route (use the task tool once).",
      "- Record progress with ctf_orch_event and stop this turn.",
    ].join("\n");

    const promptAsync = (ctx.client as unknown as { session?: { promptAsync?: unknown } } | null)?.session
      ?.promptAsync;
    if (typeof promptAsync !== "function") {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.error", () => {
        notesStore.recordScan("Auto loop disabled: client.session.promptAsync unavailable.");
      });
      return;
    }

    store.recordAutoLoopPrompt(sessionID);
    safeNoteWrite("autoloop.tick", () => {
      notesStore.recordScan(`Auto loop tick: session=${sessionID} route=${decision.primary} (${trigger})`);
    });

    try {
      await (promptAsync as (args: unknown) => Promise<unknown>)({
        path: { id: sessionID },
        body: {
          parts: [
            {
              type: "text",
              text: promptText,
              synthetic: true,
              metadata: {
                source: "oh-my-Aegis.auto-loop",
                iteration,
                next_route: decision.primary,
              },
            },
          ],
        },
      });
    } catch (error) {
      store.setAutoLoopEnabled(sessionID, false);
      safeNoteWrite("autoloop.error", () => {
        notesStore.recordScan("Auto loop disabled: failed to send promptAsync.");
      });
      noteHookError("autoloop", error);
    }
  };

  const getBountyScopePolicy = (): BountyScopePolicy | null => {
    const now = Date.now();
    if (now - scopePolicyCache.lastLoadAt < 60_000) {
      return scopePolicyCache.result.ok ? scopePolicyCache.result.policy : null;
    }
    scopePolicyCache.lastLoadAt = now;
    const result = loadScopePolicyFromWorkspace(ctx.directory, {
      candidates: config.bounty_policy.scope_doc_candidates,
    });
    scopePolicyCache.result = result;
    if (result.ok) {
      const changed =
        scopePolicyCache.sourcePath !== result.policy.sourcePath ||
        scopePolicyCache.sourceMtimeMs !== result.policy.sourceMtimeMs;
      scopePolicyCache.sourcePath = result.policy.sourcePath;
      scopePolicyCache.sourceMtimeMs = result.policy.sourceMtimeMs;
      if (changed) {
        safeNoteWrite("scope.policy", () => {
          notesStore.recordScan(
            `Scope doc loaded: ${result.policy.sourcePath} (allow=${result.policy.allowedHostsExact.length + result.policy.allowedHostsSuffix.length}, deny=${result.policy.deniedHostsExact.length + result.policy.deniedHostsSuffix.length}, blackout=${result.policy.blackoutWindows.length})`
          );
          for (const w of result.policy.warnings) {
            notesStore.recordScan(`Scope doc warning: ${w}`);
          }
        });
      }
      return result.policy;
    }
    return null;
  };

  const store = new SessionStore(ctx.directory, ({ sessionID, state, reason }) => {
    safeNoteWrite("observer", () => {
      notesStore.recordChange(sessionID, state, reason, route(state, config));
    });
  }, config.default_mode);

  if (!config.enabled) {
    return {};
  }

  const controlTools = createControlTools(store, notesStore, config, ctx.directory);
  const readiness = buildReadinessReport(ctx.directory, notesStore, config);
  if (notesReady && (!readiness.ok || readiness.warnings.length > 0)) {
    const entries: string[] = [];
    if (readiness.checkedConfigPath) {
      entries.push(`config=${readiness.checkedConfigPath}`);
    }
    if (readiness.issues.length > 0) {
      entries.push(`issues=${readiness.issues.join("; ")}`);
    }
    if (readiness.warnings.length > 0) {
      entries.push(`warnings=${readiness.warnings.join("; ")}`);
    }
    safeNoteWrite("readiness", () => {
      notesStore.recordScan(`Readiness check: ${entries.join(" | ")}`);
    });
  }

  return {
    event: async ({ event }) => {
      try {
        if (!event || typeof event !== "object") {
          return;
        }
        const e = event as { type?: string; properties?: Record<string, unknown> };
        const type = typeof e.type === "string" ? e.type : "";
        const props = e.properties ?? {};

        if (type === "session.idle") {
          const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
          if (sessionID) {
            await maybeAutoloopTick(sessionID, "session.idle");
          }
          return;
        }

        if (type === "session.status") {
          const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";
          const status = props.status as { type?: string } | undefined;
          if (sessionID && status?.type === "idle") {
            await maybeAutoloopTick(sessionID, "session.status idle");
          }
        }
      } catch (error) {
        noteHookError("event", error);
      }
    },

    config: async (runtimeConfig) => {
      if (!config.enable_builtin_mcps) {
        return;
      }
      const existingMcp = isRecord(runtimeConfig.mcp) ? runtimeConfig.mcp : {};
      runtimeConfig.mcp = {
        ...createBuiltinMcps(config.disabled_mcps),
        ...existingMcp,
      };
    },

    tool: {
      ...controlTools,
    },

    "chat.message": async (input, output) => {
      try {
        const state = store.get(input.sessionID);

        const role = (output.message as unknown as { role?: string } | undefined)?.role;
        const isUserMessage = role === "user";
        let ultraworkEnabled = state.ultraworkEnabled;

        const messageText = textFromParts(output.parts as unknown[]);
        const contextText = [textFromUnknown(input), messageText].filter(Boolean).join("\n");

        if (isUserMessage && /\b(ultrawork|ulw)\b/i.test(contextText)) {
          store.setUltraworkEnabled(input.sessionID, true);
          store.setAutoLoopEnabled(input.sessionID, true);
          ultraworkEnabled = true;
          safeNoteWrite("ultrawork.enabled", () => {
            notesStore.recordScan("Ultrawork enabled by keyword in user prompt.");
          });
        }

        if (config.enable_injection_logging && notesReady) {
          const indicators = detectInjectionIndicators(contextText);
          if (indicators.length > 0) {
            safeNoteWrite("chat.message.injection", () => {
              notesStore.recordInjectionAttempt("chat.message", indicators, contextText);
            });
          }
        }
        const modeMatch = messageText.match(/\bMODE\s*:\s*(CTF|BOUNTY)\b/i);
        if (modeMatch) {
          store.setMode(input.sessionID, modeMatch[1].toUpperCase() as "CTF" | "BOUNTY");
        } else if (isUserMessage && ultraworkEnabled) {
          if (/\bctf\b/i.test(messageText)) {
            store.setMode(input.sessionID, "CTF");
          } else if (/\bbounty\b/i.test(messageText)) {
            store.setMode(input.sessionID, "BOUNTY");
          }
        } else if (config.enforce_mode_header) {
          const parts = output.parts as Array<Record<string, unknown>>;
          parts.unshift({
            type: "text",
            text: `MODE: ${state.mode}`,
          });
        }

        if (config.target_detection.enabled) {
          const lockAfterFirst = config.target_detection.lock_after_first;
          const onlyInScan = config.target_detection.only_in_scan;
          const canSetTarget =
            (!onlyInScan || state.phase === "SCAN") && (!lockAfterFirst || state.targetType === "UNKNOWN");
          if (canSetTarget) {
            const target = detectTargetType(contextText);
            if (target) {
              store.setTargetType(input.sessionID, target);
            }
          }
        }

        const freeTextSignalsEnabled = config.allow_free_text_signals || ultraworkEnabled;
        if (freeTextSignalsEnabled) {
          if (/\bscan_completed\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "scan_completed");
          }
          if (/\bplan_completed\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "plan_completed");
          }
          if (/\bverify_success\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "verify_success");
          }
          if (/\bverify_fail\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "verify_fail");
          }
          if (/\bno_new_evidence\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "no_new_evidence");
          }
          if (/\bsame_payload_(repeat|repeated)\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "same_payload_repeat");
          }
          if (/\bnew_evidence\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "new_evidence");
          }
          if (/\breadonly_inconclusive\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "readonly_inconclusive");
          }
          if (/\breset_loop\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "reset_loop");
          }

          if (/\bscope_confirmed\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "scope_confirmed");
          }

          if (/\bcandidate_found\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "candidate_found");
          }

          if (/\bscope\s+confirmed\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "scope_confirmed");
          }

          if (/\bcandidate\s*found\b/i.test(messageText)) {
            store.applyEvent(input.sessionID, "candidate_found");
          }
        }
      } catch (error) {
        noteHookError("chat.message", error);
      }

    },

    "tool.execute.before": async (input, output) => {
      try {
      if (input.tool === "todowrite") {
        const state = store.get(input.sessionID);
        const args = isRecord(output.args) ? output.args : {};
        const todos = Array.isArray(args.todos) ? args.todos : [];
        args.todos = todos;

        if (config.enforce_todo_single_in_progress) {
          const count = inProgressTodoCount(args);
          if (count > 1) {
            let seen = false;
            for (const todo of todos) {
              if (!isRecord(todo) || todo.status !== "in_progress") {
                continue;
              }
              if (!seen) {
                seen = true;
                continue;
              }
              todo.status = "pending";
            }
            safeNoteWrite("todowrite.guard", () => {
              notesStore.recordScan("Normalized todowrite payload: only one in_progress item is allowed.");
            });
          }
        }

        if (
          state.ultraworkEnabled &&
          state.mode === "CTF" &&
          state.latestVerified.trim().length === 0
        ) {
          const hasOpenTodo = todos.some(
            (todo) =>
              isRecord(todo) &&
              (todo.status === "pending" || todo.status === "in_progress")
          );

          if (!hasOpenTodo) {
            const decision = route(state, config);
            todos.push({
              content: `Continue CTF loop via '${decision.primary}' until verify_success (no early stop).`,
              status: "pending",
              priority: "high",
            });
            safeNoteWrite("todowrite.continuation", () => {
              notesStore.recordScan(
                `Todo continuation enforced (ultrawork): added pending item for route '${decision.primary}'.`
              );
            });
          }
        }

        output.args = args;
        return;
      }

      if (input.tool === "read") {
        const args = isRecord(output.args) ? output.args : {};
        const filePath = typeof args.filePath === "string" ? args.filePath : "";
        if (filePath) {
          readContextByCallId.set(input.callID, { sessionID: input.sessionID, filePath });
        }
      }

      if (input.tool === "task") {
        const state = store.get(input.sessionID);
        const args = (output.args ?? {}) as Record<string, unknown>;
        const decision = route(state, config);

        const routePinned = isNonOverridableSubagent(decision.primary);
        const userCategory = typeof args.category === "string" ? args.category : "";
        const userSubagent = typeof args.subagent_type === "string" ? args.subagent_type : "";

        if (config.auto_dispatch.enabled) {
          const dispatch = decideAutoDispatch(
            decision.primary,
            state,
            config.auto_dispatch.max_failover_retries,
            config
          );
          const hasUserCategory = typeof args.category === "string" && args.category.length > 0;
          const hasUserSubagent =
            typeof args.subagent_type === "string" && args.subagent_type.length > 0;
          const shouldForceFailover = state.pendingTaskFailover;
          const hasUserDispatch = hasUserCategory || hasUserSubagent;
          const shouldSetSubagent =
            Boolean(dispatch.subagent_type) &&
            (routePinned ||
              shouldForceFailover ||
              !config.auto_dispatch.preserve_user_category ||
              !hasUserDispatch);

          if (dispatch.subagent_type && shouldSetSubagent) {
            const forced = routePinned ? decision.primary : dispatch.subagent_type;
            if (routePinned && (userCategory || userSubagent) && (userSubagent !== forced || userCategory)) {
              safeNoteWrite("task.pin", () => {
                notesStore.recordScan(
                  `policy-pin task: route=${decision.primary} mode=${state.mode} scopeConfirmed=${state.scopeConfirmed} user_category=${userCategory || "(none)"} user_subagent=${userSubagent || "(none)"}`
                );
              });
            }
            args.subagent_type = forced;
            if ("category" in args) {
              delete args.category;
            }
            store.setLastTaskCategory(input.sessionID, forced);
            store.setLastDispatch(input.sessionID, decision.primary, forced);

            if (shouldForceFailover) {
              store.consumeTaskFailover(input.sessionID);
            }
          }

          const requestedAgent =
            typeof args.subagent_type === "string" && args.subagent_type.length > 0
              ? args.subagent_type
              : typeof args.category === "string" && args.category.length > 0
                ? args.category
                : "";
          if (requestedAgent) {
            store.setLastTaskCategory(input.sessionID, requestedAgent);
            store.setLastDispatch(input.sessionID, decision.primary, requestedAgent);
          }

          if (typeof args.prompt === "string") {
            const tail = `\n\n[oh-my-Aegis auto-dispatch] ${dispatch.reason}`;
            if (!args.prompt.includes("[oh-my-Aegis auto-dispatch]")) {
              args.prompt = `${args.prompt}${tail}`;
            }
          }
        }

        if (!config.auto_dispatch.enabled && routePinned) {
          if ((userCategory || userSubagent) && (userSubagent !== decision.primary || userCategory)) {
            safeNoteWrite("task.pin", () => {
              notesStore.recordScan(
                `policy-pin task: route=${decision.primary} mode=${state.mode} scopeConfirmed=${state.scopeConfirmed} user_category=${userCategory || "(none)"} user_subagent=${userSubagent || "(none)"}`
              );
            });
          }
          args.subagent_type = decision.primary;
          if ("category" in args) {
            delete args.category;
          }
          store.setLastTaskCategory(input.sessionID, decision.primary);
          store.setLastDispatch(input.sessionID, decision.primary, decision.primary);
        }

        if (typeof args.prompt === "string" && !hasPlaybookMarker(args.prompt)) {
          args.prompt = `${args.prompt}\n\n${buildTaskPlaybook(state)}`;
        }

        output.args = args;
        return;
      }

      if (input.tool !== "bash") {
        return;
      }

      const state = store.get(input.sessionID);
      const command = extractBashCommand(output.args);
      const scopePolicy = state.mode === "BOUNTY" ? getBountyScopePolicy() : null;
      const decision = evaluateBashCommand(command, config, state.mode, {
        scopeConfirmed: state.scopeConfirmed,
        scopePolicy,
        now: new Date(),
      });
      if (!decision.allow) {
        const denyLevel = decision.denyLevel ?? "hard";
        if (denyLevel === "soft") {
          pruneSoftBashOverrides();
          const override = softBashOverrideByCallId.get(input.callID);
          if (override) {
            softBashOverrideByCallId.delete(input.callID);
            safeNoteWrite("bash.override", () => {
              notesStore.recordScan(
                `policy-override bash: reason=${override.reason || "(none)"} command=${override.command || "(empty)"}`
              );
            });
            return;
          }
        }
        throw new AegisPolicyDenyError(decision.reason ?? "Command blocked by Aegis policy.");
      }
      } catch (error) {
        if (error instanceof AegisPolicyDenyError) {
          throw error;
        }
        noteHookError("tool.execute.before", error);
      }
    },

    "permission.ask": async (input, output) => {
      try {
        const state = store.get(input.sessionID);
        if (input.type.toLowerCase() !== "bash") {
          return;
        }

        const command = extractBashCommand(input.metadata);
        const scopePolicy = state.mode === "BOUNTY" ? getBountyScopePolicy() : null;
        const decision = evaluateBashCommand(command, config, state.mode, {
          scopeConfirmed: state.scopeConfirmed,
          scopePolicy,
          now: new Date(),
        });
        output.status = "ask";
        if (!decision.allow) {
          pruneSoftBashOverrides();
          const denyLevel = decision.denyLevel ?? "hard";
          if (denyLevel === "soft") {
            if (input.callID) {
              softBashOverrideByCallId.set(input.callID, {
                addedAt: Date.now(),
                reason: decision.reason ?? "",
                command: decision.sanitizedCommand ?? command,
              });
              output.status = "ask";
            } else {
              output.status = "deny";
            }
          } else {
            output.status = "deny";
          }
        }
      } catch (error) {
        noteHookError("permission.ask", error);
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        const originalTitle = output.title;
        const originalOutput = output.output;
        const raw = `${originalTitle}\n${originalOutput}`;

        if (config.enable_injection_logging && notesReady) {
          const indicators = detectInjectionIndicators(raw);
          if (indicators.length > 0) {
            safeNoteWrite("tool.execute.after.injection", () => {
              notesStore.recordInjectionAttempt(`tool.${input.tool}`, indicators, raw);
            });
          }
        }

        if (isContextLengthFailure(raw)) {
          store.applyEvent(input.sessionID, "context_length_exceeded");
        }

        if (isLikelyTimeout(raw)) {
          store.applyEvent(input.sessionID, "timeout");
        }

        const stateBeforeVerifyCheck = store.get(input.sessionID);
        const routeVerifier =
          input.tool === "task" &&
          (stateBeforeVerifyCheck.lastTaskCategory === "ctf-verify" ||
            stateBeforeVerifyCheck.lastTaskCategory === "ctf-decoy-check");

        const verificationRelevant =
          routeVerifier ||
          isVerificationSourceRelevant(
            input.tool,
            output.title,
            {
              verifierToolNames: config.verification.verifier_tool_names,
              verifierTitleMarkers: config.verification.verifier_title_markers,
            }
          );

        if (verificationRelevant) {
          if (isVerifyFailure(raw)) {
            store.applyEvent(input.sessionID, "verify_fail");
          } else if (isVerifySuccess(raw)) {
            store.applyEvent(input.sessionID, "verify_success");
          }
        }

        const classifiedFailure = classifyFailureReason(raw);
        if (classifiedFailure === "hypothesis_stall") {
          const stateForFailure = store.get(input.sessionID);
          const failedRoute = stateForFailure.lastTaskCategory || route(stateForFailure, config).primary;
          const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
          store.setFailureDetails(input.sessionID, classifiedFailure, failedRoute, summary);
          if (/(same payload|same_payload)/i.test(raw)) {
            store.applyEvent(input.sessionID, "same_payload_repeat");
          } else {
            store.applyEvent(input.sessionID, "no_new_evidence");
          }
        } else if (classifiedFailure === "exploit_chain" || classifiedFailure === "environment") {
          const stateForFailure = store.get(input.sessionID);
          const failedRoute = stateForFailure.lastTaskCategory || route(stateForFailure, config).primary;
          const summary = raw.replace(/\s+/g, " ").trim().slice(0, 240);
          store.recordFailure(input.sessionID, classifiedFailure, failedRoute, summary);
        }

        if (input.tool === "task") {
          const state = store.get(input.sessionID);
          const isRetryableFailure = isRetryableTaskFailure(raw);
          const tokenOrQuotaFailure = isTokenOrQuotaFailure(raw);
          const useModelFailover =
            tokenOrQuotaFailure &&
            config.dynamic_model.enabled &&
            config.dynamic_model.generate_variants;
          const isHardFailure =
            !isRetryableFailure &&
            (classifiedFailure === "verification_mismatch" ||
              classifiedFailure === "hypothesis_stall" ||
              classifiedFailure === "exploit_chain" ||
              classifiedFailure === "environment");

          if (isRetryableFailure) {
            store.recordDispatchOutcome(input.sessionID, "retryable_failure");
          } else if (isHardFailure) {
            store.recordDispatchOutcome(input.sessionID, "hard_failure");
          } else {
            store.recordDispatchOutcome(input.sessionID, "success");
          }


          if (tokenOrQuotaFailure) {
            const lastSubagent = state.lastTaskSubagent;
            const model = lastSubagent ? agentModel(lastSubagent) : undefined;
            if (model) {
              store.markModelUnhealthy(input.sessionID, model, "rate_limit_or_quota");
              safeNoteWrite("model.unhealthy", () => {
                notesStore.recordScan(
                  `Model marked unhealthy: ${model} (via ${lastSubagent}). Dynamic failover will route to alternative model.`
                );
              });
            }
          }

          if (
            isRetryableFailure &&
            !useModelFailover &&
            state.taskFailoverCount < config.auto_dispatch.max_failover_retries
          ) {
            store.triggerTaskFailover(input.sessionID);
            safeNoteWrite("task.failover", () => {
              notesStore.recordScan(
                `Auto failover armed: next task call will use fallback subagent (attempt ${state.taskFailoverCount + 1}/${config.auto_dispatch.max_failover_retries}).`
              );
            });
          } else if (!isRetryableFailure && (state.pendingTaskFailover || state.taskFailoverCount > 0)) {
            store.clearTaskFailover(input.sessionID);
          }
        }

        if (input.tool === "read") {
          const entry = readContextByCallId.get(input.callID);
          if (entry) {
            readContextByCallId.delete(input.callID);
            if (config.context_injection.enabled) {
              const rawPath = entry.filePath;
              const resolvedTarget = isAbsolute(rawPath) ? resolve(rawPath) : resolve(ctx.directory, rawPath);
              const lowered = resolvedTarget.toLowerCase();
              const isContextFile = lowered.endsWith("/agents.md") || lowered.endsWith("\\agents.md") || lowered.endsWith("/readme.md") || lowered.endsWith("\\readme.md");
              if (!isContextFile && isPathInsideRoot(resolvedTarget, ctx.directory)) {
                let baseDir = resolvedTarget;
                try {
                  const st = statSync(resolvedTarget);
                  if (st.isFile()) {
                    baseDir = dirname(resolvedTarget);
                  }
                } catch {
                  baseDir = dirname(resolvedTarget);
                }

                const injectedSet = injectedContextPathsFor(input.sessionID);
                const maxFiles = config.context_injection.max_files;
                const maxPer = config.context_injection.max_chars_per_file;
                const maxTotal = config.context_injection.max_total_chars;

                const toInject: string[] = [];
                let current = baseDir;
                for (let depth = 0; depth < 30; depth += 1) {
                  if (!isPathInsideRoot(current, ctx.directory)) {
                    break;
                  }
                  if (config.context_injection.inject_agents_md) {
                    const agents = join(current, "AGENTS.md");
                    if (existsSync(agents) && !injectedSet.has(agents) && toInject.length < maxFiles) {
                      injectedSet.add(agents);
                      toInject.push(agents);
                    }
                  }
                  if (config.context_injection.inject_readme_md) {
                    const readme = join(current, "README.md");
                    if (existsSync(readme) && !injectedSet.has(readme) && toInject.length < maxFiles) {
                      injectedSet.add(readme);
                      toInject.push(readme);
                    }
                  }
                  if (toInject.length >= maxFiles) {
                    break;
                  }
                  if (resolve(current) === resolve(ctx.directory)) {
                    break;
                  }
                  const parent = dirname(current);
                  if (parent === current) {
                    break;
                  }
                  current = parent;
                }

                if (toInject.length > 0) {
                  const relTarget = relative(ctx.directory, resolvedTarget);
                  const lines: string[] = [];
                  const pushLine = (value: string): void => {
                    lines.push(value);
                  };
                  pushLine("[oh-my-Aegis context-injector]");
                  pushLine(`read_target: ${relTarget}`);
                  pushLine("files:");
                  for (const p of toInject) {
                    pushLine(`- ${relative(ctx.directory, p)}`);
                  }
                  pushLine("");

                  let totalChars = lines.reduce((sum, item) => sum + item.length + 1, 0);
                  for (const p of toInject) {
                    let content = "";
                    try {
                      content = readFileSync(p, "utf-8");
                    } catch {
                      continue;
                    }
                    if (content.length > maxPer) {
                      content = `${content.slice(0, maxPer)}\n...[truncated]`;
                    }
                    const rel = relative(ctx.directory, p);
                    const block = [`--- BEGIN ${rel} ---`, content.trimEnd(), `--- END ${rel} ---`, ""].join("\n");
                    if (totalChars + block.length + 1 > maxTotal) {
                      break;
                    }
                    totalChars += block.length + 1;
                    pushLine(block);
                  }

                  const injectedText = lines.join("\n").trimEnd();
                  if (injectedText.length > 0) {
                    output.output = `${injectedText}\n\n${output.output}`;
                  }
                }
              }
            }
          }
        }

        if (config.tool_output_truncator.enabled) {
          const max = config.tool_output_truncator.max_chars;
          if (typeof output.output === "string" && output.output.length > max) {
            const savedPath = writeToolOutputArtifact({
              sessionID: input.sessionID,
              tool: input.tool,
              callID: input.callID,
              title: originalTitle,
              output: originalOutput,
            });

            const pre = output.output;
            const headTarget = config.tool_output_truncator.head_chars;
            const tailTarget = config.tool_output_truncator.tail_chars;
            const safeHead = Math.max(0, Math.min(headTarget, max));
            const safeTail = Math.max(0, Math.min(tailTarget, Math.max(0, max - safeHead)));
            const truncated = truncateWithHeadTail(pre, safeHead, safeTail);
            const savedRel = savedPath && isPathInsideRoot(savedPath, ctx.directory) ? relative(ctx.directory, savedPath) : savedPath;
            output.output = [
              "[oh-my-Aegis tool-output-truncated]",
              `- tool=${input.tool} callID=${input.callID}`,
              savedRel ? `- saved=${savedRel}` : "- saved=(failed)",
              `- original_chars=${pre.length}`,
              "",
              truncated,
            ].join("\n");
          }
        }
      } catch (error) {
        noteHookError("tool.execute.after", error);
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) {
        return;
      }
      const state = store.get(input.sessionID);
      const decision = route(state, config);
      const systemLines = [
        `MODE: ${state.mode}`,
        `PHASE: ${state.phase}`,
        `TARGET: ${state.targetType}`,
        `ULTRAWORK: ${state.ultraworkEnabled ? "ENABLED" : "DISABLED"}`,
        `NEXT_ROUTE: ${decision.primary}`,
        `RULE: 1 loop = 1 todo, then verify/log.`,
      ];
      if (state.ultraworkEnabled) {
        systemLines.push(`RULE: ultrawork enabled - do not stop without verified evidence.`);
      }
      output.system.push(systemLines.join("\n"));
    },

    "experimental.session.compacting": async (input, output) => {
      const state = store.get(input.sessionID);
      output.context.push(
        `orchestrator-state: mode=${state.mode}, phase=${state.phase}, target=${state.targetType}, verifyFailCount=${state.verifyFailCount}`
      );
      output.context.push(
        `markdown-budgets: WORKLOG ${config.markdown_budget.worklog_lines} lines/${config.markdown_budget.worklog_bytes} bytes; EVIDENCE ${config.markdown_budget.evidence_lines}/${config.markdown_budget.evidence_bytes}`
      );

      try {
        const root = notesStore.getRootDirectory();
        const contextPackPath = join(root, "CONTEXT_PACK.md");
        if (existsSync(contextPackPath)) {
          const text = readFileSync(contextPackPath, "utf-8").trim();
          if (text) {
            output.context.push(`durable-context:\n${text.slice(0, 16_000)}`);
          }
        }
      } catch (error) {
        noteHookError("session.compacting", error);
      }
    },
  };
};

export default OhMyAegisPlugin;
