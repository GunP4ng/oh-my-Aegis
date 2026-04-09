import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  applyAegisConfig,
  resolveGeminiAuthPluginEntry,
  resolveOpenAICodexAuthPluginEntry,
  resolveOpencodeConfigPath,
  resolveOpencodeDir,
} from "../install/apply-config";
import { syncPluginPackages } from "../install/plugin-packages";
import { stripJsonComments } from "../utils/json";

const packageJson = await import("../../package.json");
const PACKAGE_NAME =
  typeof packageJson.name === "string" && packageJson.name.trim().length > 0
    ? packageJson.name
    : "oh-my-aegis";
const OPENAI_CODEX_PLUGIN_PREFIX = "opencode-openai-codex-auth";

type ToggleArg = "yes" | "no" | "auto";

interface InstallArgs {
  noTui: boolean;
  chatgpt: ToggleArg;
  gemini: ToggleArg;
  bootstrap: ToggleArg;
  help: boolean;
}

interface DetectedInstallState {
  isInstalled: boolean;
  hasChatGPT: boolean;
}

let pluginPackageSyncImpl = syncPluginPackages;

export function __setInstallPluginPackageSyncForTests(
  impl: typeof syncPluginPackages | null
): void {
  pluginPackageSyncImpl = impl ?? syncPluginPackages;
}

export function printInstallHelp(): void {
  const lines = [
    "Usage:",
    "  oh-my-aegis install [--no-tui] [--chatgpt=<auto|yes|no>] [--gemini=<auto|yes|no>] [--bootstrap=<auto|yes|no>]",
    "",
    "Examples:",
    "  oh-my-aegis install",
    "  oh-my-aegis install --no-tui --chatgpt=yes",
    "  oh-my-aegis install --no-tui --gemini=yes",
    "  oh-my-aegis install --no-tui --openai=yes",
    "  oh-my-aegis install --bootstrap=yes",
    "",
    "What it does:",
    "  - adds npm plugin entry to opencode.json (@latest for auto-update)",
    "  - optionally ensures opencode-gemini-auth plugin (enabled by --gemini)",
    "  - optionally ensures opencode-openai-codex-auth plugin (enabled by --chatgpt)",
    "  - ensures required CTF/BOUNTY subagent model mappings",
    "  - optionally ensures google / openai provider model catalogs",
    "  - bootstrap flag is informational only for the Gemini OAuth flow; no extra CLI install is performed",
    "  - ensures builtin MCP mappings (context7, grep_app)",
    "  - writes/merges oh-my-Aegis.json in resolved OpenCode config dir",
    "",
    "Bootstrap behavior:",
    "  - auto (default): no additional action",
    "  - yes: prints Gemini OAuth follow-up guidance after install",
    "  - no: suppresses bootstrap note",
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
    gemini: "auto",
    bootstrap: "auto",
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
    if (arg.startsWith("--gemini=")) {
      const toggle = parseToggleArg(arg.slice("--gemini=".length));
      if (!toggle) {
        return { ok: false, error: `Invalid --gemini value: ${arg.slice("--gemini=".length)}` };
      }
      parsed.gemini = toggle;
      continue;
    }
    if (arg === "--gemini") {
      const next = args[i + 1];
      if (!next) {
        return { ok: false, error: "Missing value after --gemini" };
      }
      const toggle = parseToggleArg(next);
      if (!toggle) {
        return { ok: false, error: `Invalid --gemini value: ${next}` };
      }
      parsed.gemini = toggle;
      i += 1;
      continue;
    }
    if (arg.startsWith("--bootstrap=")) {
      const toggle = parseToggleArg(arg.slice("--bootstrap=".length));
      if (!toggle) {
        return { ok: false, error: `Invalid --bootstrap value: ${arg.slice("--bootstrap=".length)}` };
      }
      parsed.bootstrap = toggle;
      continue;
    }
    if (arg === "--bootstrap") {
      const next = args[i + 1];
      if (!next) {
        return { ok: false, error: "Missing value after --bootstrap" };
      }
      const toggle = parseToggleArg(next);
      if (!toggle) {
        return { ok: false, error: `Invalid --bootstrap value: ${next}` };
      }
      parsed.bootstrap = toggle;
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
    const geminiDefault = true;

    let enableChatGPT = resolveToggle(parsedArgs.value.chatgpt, chatgptDefault);
    let enableGemini = resolveToggle(parsedArgs.value.gemini, geminiDefault);

    const canUseTui = !parsedArgs.value.noTui && Boolean(process.stdin.isTTY && process.stdout.isTTY);

    const shouldPromptChatGPT = canUseTui && parsedArgs.value.chatgpt === "auto";
    const shouldPromptGemini = canUseTui && !state.isInstalled && parsedArgs.value.gemini === "auto";

    const promptSteps = Number(shouldPromptChatGPT) + Number(shouldPromptGemini);
    const totalSteps = 7 + promptSteps;
    let step = 1;

    if (canUseTui) {
      if (shouldPromptChatGPT) {
        printStep(step++, totalSteps, "Selecting OpenAI Codex integration...");
        enableChatGPT = await promptYesNo("Enable OpenAI Codex integration?", chatgptDefault);
      }
      if (shouldPromptGemini) {
        printStep(step++, totalSteps, "Selecting Gemini OAuth integration...");
        enableGemini = await promptYesNo("Enable Gemini OAuth integration?", true);
      }
    }

    printStep(step++, totalSteps, "Resolving oh-my-Aegis npm plugin tag...");
    const pluginEntry = `${PACKAGE_NAME}@latest`;

    let geminiAuthPluginEntry = "opencode-gemini-auth@latest";
    if (enableGemini) {
      printStep(step++, totalSteps, "Resolving Gemini auth plugin version...");
      geminiAuthPluginEntry = await resolveGeminiAuthPluginEntry();
    } else {
      printStep(step++, totalSteps, "Skipping Gemini auth plugin resolution...");
    }

    let openAICodexAuthPluginEntry = "opencode-openai-codex-auth@latest";
    if (enableChatGPT) {
      printStep(step++, totalSteps, "Resolving openai codex auth plugin version...");
      openAICodexAuthPluginEntry = await resolveOpenAICodexAuthPluginEntry();
    } else {
      printStep(step++, totalSteps, "Skipping openai codex auth plugin resolution...");
    }

    printStep(step++, totalSteps, "Applying OpenCode / Aegis configuration...");
    const result = applyAegisConfig({
      pluginEntry,
      backupExistingConfig: true,
      geminiAuthPluginEntry,
      openAICodexAuthPluginEntry,
      ensureGeminiAuthPlugin: enableGemini,
      ensureGoogleProviderCatalog: enableGemini,
      ensureOpenAICodexAuthPlugin: enableChatGPT,
      ensureOpenAIProviderCatalog: enableChatGPT,
    });

    printStep(step++, totalSteps, "Installing plugin packages into OpenCode config...");
    const pluginPackageSpecs = [
      enableGemini ? geminiAuthPluginEntry : null,
      enableChatGPT ? openAICodexAuthPluginEntry : null,
    ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    const installedPluginPackages = pluginPackageSyncImpl(dirname(result.opencodePath), pluginPackageSpecs);

    printStep(step++, totalSteps, "Done.");

    const lines = [
      "oh-my-Aegis install complete.",
      `- plugin entry ensured: ${result.pluginEntry}`,
      enableGemini
        ? `- gemini auth plugin ensured: ${geminiAuthPluginEntry}`
        : "- gemini auth plugin: skipped by install options",
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
      installedPluginPackages.length > 0
        ? `- installed plugin packages: ${installedPluginPackages.join(", ")}`
        : "- installed plugin packages: (none)",
      `- ensured provider catalogs: ${[enableGemini ? "google" : null, enableChatGPT ? "openai" : null].filter(Boolean).join(", ") || "(none)"}`,
      enableGemini ? "- Gemini OAuth integration: enabled" : "- Gemini OAuth integration: disabled",
      enableGemini ? "- Gemini auth: run `opencode auth login`, choose Google -> OAuth with Google (Gemini CLI)" : null,
      parsedArgs.value.bootstrap === "yes"
        ? "- bootstrap note: no extra provider CLI install is performed in this setup; authenticate Gemini via `opencode auth login`"
        : null,
      "- verify with: ctf_orch_readiness",
    ].filter(Boolean);
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`oh-my-Aegis install failed: ${message}\n`);
    return 1;
  }
}
