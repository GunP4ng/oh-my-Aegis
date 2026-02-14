import type { Plugin } from "@opencode-ai/plugin";
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

        const messageText = textFromParts(output.parts as unknown[]);
        const contextText = [textFromUnknown(input), messageText].filter(Boolean).join("\n");
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

        if (config.allow_free_text_signals) {
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
      if (input.tool === "todowrite" && config.enforce_todo_single_in_progress) {
        const args = isRecord(output.args) ? output.args : {};
        const todos = Array.isArray(args.todos) ? args.todos : [];
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
        output.args = args;
        return;
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
        if (!decision.allow) {
          output.status = "deny";
        }
      } catch (error) {
        noteHookError("permission.ask", error);
      }
    },

    "tool.execute.after": async (input, output) => {
      try {
        const raw = `${output.title}\n${output.output}`;

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
      output.system.push(
        [
          `MODE: ${state.mode}`,
          `PHASE: ${state.phase}`,
          `TARGET: ${state.targetType}`,
          `NEXT_ROUTE: ${decision.primary}`,
          `RULE: 1 loop = 1 todo, then verify/log.`,
        ].join("\n")
      );
    },

    "experimental.session.compacting": async (input, output) => {
      const state = store.get(input.sessionID);
      output.context.push(
        `orchestrator-state: mode=${state.mode}, phase=${state.phase}, target=${state.targetType}, verifyFailCount=${state.verifyFailCount}`
      );
      output.context.push(
        `markdown-budgets: WORKLOG ${config.markdown_budget.worklog_lines} lines/${config.markdown_budget.worklog_bytes} bytes; EVIDENCE ${config.markdown_budget.evidence_lines}/${config.markdown_budget.evidence_bytes}`
      );
    },
  };
};

export default OhMyAegisPlugin;
