import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  applyAegisConfig,
  resolveOpenAICodexAuthPluginEntry,
  resolveOpencodeConfigPath,
  resolveOpencodeDir,
} from "../install/apply-config";
import { resolvePluginEntryWithVersion } from "../install/plugin-version";
import { stripJsonComments } from "../utils/json";

const packageJson = await import("../../package.json");
const PACKAGE_NAME =
  typeof packageJson.name === "string" && packageJson.name.trim().length > 0
    ? packageJson.name
    : "oh-my-aegis";
const PACKAGE_VERSION =
  typeof packageJson.version === "string" && packageJson.version.trim().length > 0
    ? packageJson.version
    : "0.0.0";
const OPENAI_CODEX_PLUGIN_PREFIX = "opencode-openai-codex-auth";

type ToggleArg = "yes" | "no" | "auto";

interface InstallArgs {
  noTui: boolean;
  chatgpt: ToggleArg;
  help: boolean;
}

interface DetectedInstallState {
  isInstalled: boolean;
  hasChatGPT: boolean;
}

export function printInstallHelp(): void {
  const lines = [
    "Usage:",
    "  oh-my-aegis install [--no-tui] [--chatgpt=<auto|yes|no>]",
    "",
    "Examples:",
    "  oh-my-aegis install",
    "  oh-my-aegis install --no-tui --chatgpt=yes",
    "  oh-my-aegis install --no-tui --openai=yes",
    "",
    "What it does:",
    "  - adds package plugin entry to opencode.json (tag/version pinned)",
    "  - ensures opencode-openai-codex-auth plugin is present",
    "  - ensures required CTF/BOUNTY subagent model mappings",
    "  - ensures openai provider model catalog",
    "  - ensures builtin MCP mappings (context7, grep_app)",
    "  - writes/merges ~/.config/opencode/oh-my-Aegis.json",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseToggleArg(value: string): ToggleArg | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "no" || normalized === "auto") {
    return normalized;
  }
  return null;
}

function parseInstallArgs(args: string[]): { ok: true; value: InstallArgs } | { ok: false; error: string } {
  const parsed: InstallArgs = {
    noTui: false,
    chatgpt: "auto",
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--no-tui") {
      parsed.noTui = true;
      continue;
    }
    if (arg.startsWith("--chatgpt=")) {
      const toggle = parseToggleArg(arg.slice("--chatgpt=".length));
      if (!toggle) {
        return { ok: false, error: `Invalid --chatgpt value: ${arg.slice("--chatgpt=".length)}` };
      }
      parsed.chatgpt = toggle;
      continue;
    }
    if (arg === "--chatgpt") {
      const next = args[i + 1];
      if (!next) {
        return { ok: false, error: "Missing value after --chatgpt" };
      }
      const toggle = parseToggleArg(next);
      if (!toggle) {
        return { ok: false, error: `Invalid --chatgpt value: ${next}` };
      }
      parsed.chatgpt = toggle;
      i += 1;
      continue;
    }
    if (arg.startsWith("--openai=") || arg.startsWith("--openai-codex-auth=")) {
      const raw = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : "";
      const toggle = parseToggleArg(raw);
      if (!toggle) {
        return { ok: false, error: `Invalid --openai value: ${raw}` };
      }
      parsed.chatgpt = toggle;
      continue;
    }
    if (arg === "--openai" || arg === "--openai-codex-auth") {
      const next = args[i + 1];
      if (!next) {
        return { ok: false, error: `Missing value after ${arg}` };
      }
      const toggle = parseToggleArg(next);
      if (!toggle) {
        return { ok: false, error: `Invalid ${arg} value: ${next}` };
      }
      parsed.chatgpt = toggle;
      i += 1;
      continue;
    }

    return { ok: false, error: `Unknown install argument: ${arg}` };
  }

  return { ok: true, value: parsed };
}

function detectInstalledState(): DetectedInstallState {
  const fallback: DetectedInstallState = {
    isInstalled: false,
    hasChatGPT: true,
  };

  try {
    const opencodeDir = resolveOpencodeDir(process.env);
    const path = resolveOpencodeConfigPath(opencodeDir);
    if (!existsSync(path)) return fallback;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
    const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];
    const values = plugins.filter((item): item is string => typeof item === "string");

    return {
      isInstalled: values.some((item) => item.startsWith(PACKAGE_NAME)),
      hasChatGPT: values.some((item) => item === OPENAI_CODEX_PLUGIN_PREFIX || item.startsWith(`${OPENAI_CODEX_PLUGIN_PREFIX}@`)),
    };
  } catch {
    return fallback;
  }
}

function printStep(step: number, total: number, message: string): void {
  process.stdout.write(`[${step}/${total}] ${message}\n`);
}

function resolveToggle(toggle: ToggleArg, autoDefault: boolean): boolean {
  if (toggle === "yes") return true;
  if (toggle === "no") return false;
  return autoDefault;
}

async function promptYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  try {
    while (true) {
      const answerRaw = await rl.question(`${question}${suffix}`);
      const answer = answerRaw.trim().toLowerCase();
      if (!answer) return defaultValue;
      if (answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      process.stdout.write("Please answer yes or no.\n");
    }
  } finally {
    rl.close();
  }
}

export async function runInstall(commandArgs: string[] = []): Promise<number> {
  try {
    const parsedArgs = parseInstallArgs(commandArgs);
    if (!parsedArgs.ok) {
      process.stderr.write(`${parsedArgs.error}\n\n`);
      printInstallHelp();
      return 1;
    }
    if (parsedArgs.value.help) {
      printInstallHelp();
      return 0;
    }

    const state = detectInstalledState();
    process.stdout.write(`oh-my-Aegis ${state.isInstalled ? "update" : "install"} start.\n`);

    const chatgptDefault = state.isInstalled ? state.hasChatGPT : true;

    let enableChatGPT = resolveToggle(parsedArgs.value.chatgpt, chatgptDefault);

    const canUseTui = !parsedArgs.value.noTui && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (canUseTui) {
      if (parsedArgs.value.chatgpt === "auto") {
        enableChatGPT = await promptYesNo("Enable OpenAI Codex integration?", chatgptDefault);
      }
    }

    const totalSteps = 3 + (enableChatGPT ? 1 : 0);
    let step = 1;

    printStep(step++, totalSteps, "Resolving oh-my-Aegis plugin version...");
    const pluginEntry = await resolvePluginEntryWithVersion(PACKAGE_NAME, PACKAGE_VERSION);

    let openAICodexAuthPluginEntry = "opencode-openai-codex-auth@latest";
    if (enableChatGPT) {
      printStep(step++, totalSteps, "Resolving openai codex auth plugin version...");
      openAICodexAuthPluginEntry = await resolveOpenAICodexAuthPluginEntry();
    }

    printStep(step++, totalSteps, "Applying OpenCode / Aegis configuration...");
    const result = applyAegisConfig({
      pluginEntry,
      backupExistingConfig: true,
      openAICodexAuthPluginEntry,
      ensureAntigravityAuthPlugin: false,
      ensureGoogleProviderCatalog: false,
      ensureOpenAICodexAuthPlugin: enableChatGPT,
      ensureOpenAIProviderCatalog: enableChatGPT,
    });

    printStep(step++, totalSteps, "Done.");
    const lines = [
      "oh-my-Aegis install complete.",
      `- plugin entry ensured: ${result.pluginEntry}`,
      enableChatGPT
        ? `- openai codex auth plugin ensured: ${openAICodexAuthPluginEntry}`
        : "- openai codex auth plugin: skipped by install options",
      `- OpenCode config updated: ${result.opencodePath}`,
      result.backupPath ? `- backup created: ${result.backupPath}` : "- backup skipped (new config)",
      `- Aegis config ensured: ${result.aegisPath}`,
      result.addedAgents.length > 0
        ? `- added missing subagents: ${result.addedAgents.join(", ")}`
        : "- subagent mappings already present",
      result.ensuredBuiltinMcps.length > 0
        ? `- ensured builtin MCPs: ${result.ensuredBuiltinMcps.join(", ")}`
        : "- builtin MCPs disabled by config",
      `- ensured provider catalogs: ${[enableChatGPT ? "openai" : null].filter(Boolean).join(", ") || "(none)"}`,
      "- verify with: ctf_orch_readiness",
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`oh-my-Aegis install failed: ${message}\n`);
    return 1;
  }
}
