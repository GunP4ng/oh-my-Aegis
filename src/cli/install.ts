import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  applyAegisConfig,
  resolveOpenAICodexAuthPluginEntry,
  resolveOpencodeConfigPath,
  resolveOpencodeDir,
} from "../install/apply-config";
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
  claude: ToggleArg;
  bootstrap: ToggleArg;
  help: boolean;
}

interface DetectedInstallState {
  isInstalled: boolean;
  hasChatGPT: boolean;
  hasGeminiCliProviderCatalog: boolean;
}

export function printInstallHelp(): void {
  const lines = [
    "Usage:",
    "  oh-my-aegis install [--no-tui] [--chatgpt=<auto|yes|no>] [--gemini=<auto|yes|no>] [--claude=<auto|yes|no>] [--bootstrap=<auto|yes|no>]",
    "",
    "Examples:",
    "  oh-my-aegis install",
    "  oh-my-aegis install --no-tui --chatgpt=yes",
    "  oh-my-aegis install --no-tui --gemini=no --claude=yes",
    "  oh-my-aegis install --no-tui --openai=yes",
    "  oh-my-aegis install --bootstrap=yes",
    "",
    "What it does:",
    "  - adds npm plugin entry to opencode.json (@latest for auto-update)",
    "  - optionally ensures opencode-openai-codex-auth plugin (enabled by --chatgpt)",
    "  - ensures required CTF/BOUNTY subagent model mappings",
    "  - optionally ensures openai provider model catalog (when --chatgpt is enabled)",
    "  - optional CLI bootstrap (--bootstrap): npm-first install + interactive login launch for gemini/claude",
    "  - ensures builtin MCP mappings (context7, grep_app)",
    "  - writes/merges oh-my-Aegis.json in resolved OpenCode config dir",
    "",
    "Bootstrap behavior:",
    "  - auto (default): bootstrap only on fresh install, only in interactive TTY",
    "  - yes: force bootstrap in interactive TTY; exits with code 1 if blocked or bootstrap fails",
    "  - no: never install/login CLIs during install",
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
    claude: "auto",
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
    if (arg.startsWith("--claude=")) {
      const toggle = parseToggleArg(arg.slice("--claude=".length));
      if (!toggle) {
        return { ok: false, error: `Invalid --claude value: ${arg.slice("--claude=".length)}` };
      }
      parsed.claude = toggle;
      continue;
    }
    if (arg === "--claude") {
      const next = args[i + 1];
      if (!next) {
        return { ok: false, error: "Missing value after --claude" };
      }
      const toggle = parseToggleArg(next);
      if (!toggle) {
        return { ok: false, error: `Invalid --claude value: ${next}` };
      }
      parsed.claude = toggle;
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

interface RunCommandResult {
  ok: boolean;
  exitCode: number | null;
  errorMessage: string | null;
}

interface InstallCliRuntime {
  commandExists(command: string): Promise<boolean>;
  runInteractive(command: string, args: string[]): Promise<RunCommandResult>;
}

function createDefaultInstallCliRuntime(): InstallCliRuntime {
  const commandExists = async (command: string): Promise<boolean> => {
    const tryArgs = [["--version"], ["--help"]] as const;
    for (const args of tryArgs) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await new Promise<boolean>((resolve) => {
        let settled = false;
        const complete = (value: boolean): void => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const child = spawn(command, args, { stdio: "ignore" });
        child.once("error", () => complete(false));
        child.once("close", () => complete(true));
      });
      if (exists) return true;
    }
    return false;
  };

  const runInteractive = async (command: string, args: string[]): Promise<RunCommandResult> => {
    return new Promise<RunCommandResult>((resolve) => {
      let settled = false;
      const complete = (value: RunCommandResult): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const child = spawn(command, args, {
        stdio: "inherit",
      });
      child.once("error", (error) => {
        complete({ ok: false, exitCode: null, errorMessage: error.message });
      });
      child.once("close", (code) => {
        complete({
          ok: code === 0,
          exitCode: code,
          errorMessage: code === 0 ? null : `exited with code ${String(code)}`,
        });
      });
    });
  };

  return {
    commandExists,
    runInteractive,
  };
}

let installCliRuntime: InstallCliRuntime = createDefaultInstallCliRuntime();

export function __setInstallCliRuntimeForTests(runtime: InstallCliRuntime | null): void {
  installCliRuntime = runtime ?? createDefaultInstallCliRuntime();
}

function printNodeNpmGuidance(): void {
  const npmCommands = [
    "npm install -g @google/gemini-cli",
    "npm install -g @anthropic-ai/claude-code",
  ];

  if (process.platform === "win32") {
    process.stdout.write(
      [
        "- npm was not found. Install Node.js 18+ from https://nodejs.org/en/download and reopen your terminal.",
        "- Then run:",
        ...npmCommands.map((line) => `  ${line}`),
      ].join("\n") + "\n"
    );
    return;
  }

  if (process.platform === "darwin") {
    process.stdout.write(
      [
        "- npm was not found. Install Node.js 18+ (for example with Homebrew: brew install node) and reopen your terminal.",
        "- Then run:",
        ...npmCommands.map((line) => `  ${line}`),
      ].join("\n") + "\n"
    );
    return;
  }

  process.stdout.write(
    [
      "- npm was not found. Install Node.js 18+ using your distro package manager or https://nodejs.org/en/download.",
      "- Then run:",
      ...npmCommands.map((line) => `  ${line}`),
    ].join("\n") + "\n"
  );
}

async function ensureCliInstalledWithNpm(
  runtime: InstallCliRuntime,
  cliCommand: "gemini" | "claude",
  npmPackage: "@google/gemini-cli" | "@anthropic-ai/claude-code",
  npmAvailable: boolean
): Promise<{ ok: boolean; installedNow: boolean }> {
  if (await runtime.commandExists(cliCommand)) {
    process.stdout.write(`- ${cliCommand} CLI already detected; skipping install.\n`);
    return { ok: true, installedNow: false };
  }

  if (!npmAvailable) {
    process.stdout.write(`- ${cliCommand} CLI is not installed and npm is unavailable.\n`);
    printNodeNpmGuidance();
    return { ok: false, installedNow: false };
  }

  process.stdout.write(`- Installing ${cliCommand} CLI via npm package ${npmPackage}...\n`);
  const installResult = await runtime.runInteractive("npm", ["install", "-g", npmPackage]);
  if (!installResult.ok) {
    process.stderr.write(
      `- Failed to install ${cliCommand} CLI with npm (${installResult.errorMessage ?? "unknown error"}).\n`
    );
    process.stderr.write(`- You can retry manually: npm install -g ${npmPackage}\n`);
    return { ok: false, installedNow: false };
  }

  if (!(await runtime.commandExists(cliCommand))) {
    process.stderr.write(`- npm install completed but '${cliCommand}' is still not available in PATH.\n`);
    process.stderr.write(`- Reopen your terminal and retry: npm install -g ${npmPackage}\n`);
    return { ok: false, installedNow: true };
  }

  process.stdout.write(`- ${cliCommand} CLI install completed.\n`);
  return { ok: true, installedNow: true };
}

async function runCliLoginFlow(
  runtime: InstallCliRuntime,
  cliCommand: "gemini" | "claude"
): Promise<boolean> {
  if (cliCommand === "gemini") {
    process.stdout.write("- Launching Gemini CLI. Choose 'Login with Google' in the CLI flow.\n");
  } else {
    process.stdout.write("- Launching Claude CLI interactive flow.\n");
  }

  const result = await runtime.runInteractive(cliCommand, []);
  if (result.ok) {
    process.stdout.write(`- ${cliCommand} CLI finished successfully.\n`);
    return true;
  }

  process.stderr.write(
    `- ${cliCommand} CLI exited before successful completion (${result.errorMessage ?? "unknown error"}).\n`
  );
  return false;
}

function detectInstalledState(): DetectedInstallState {
  const fallback: DetectedInstallState = {
    isInstalled: false,
    hasChatGPT: true,
    hasGeminiCliProviderCatalog: true,
  };

  try {
    const opencodeDir = resolveOpencodeDir(process.env);
    const path = resolveOpencodeConfigPath(opencodeDir);
    if (!existsSync(path)) return fallback;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
    const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];
    const values = plugins.filter((item): item is string => typeof item === "string");
    const providers = parsed.provider;
    const hasGeminiCliProviderCatalog =
      typeof providers === "object" &&
      providers !== null &&
      (Object.prototype.hasOwnProperty.call(providers, "model_cli") ||
        Object.prototype.hasOwnProperty.call(providers, "gemini_cli"));

    return {
      isInstalled: values.some((item) => item.startsWith(PACKAGE_NAME)),
      hasChatGPT: values.some((item) => item === OPENAI_CODEX_PLUGIN_PREFIX || item.startsWith(`${OPENAI_CODEX_PLUGIN_PREFIX}@`)),
      hasGeminiCliProviderCatalog,
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

function ensureGeminiExperimentalPlanEnabled(): void {
  const home = process.env.HOME;
  if (!home || home.trim().length === 0) {
    process.stderr.write(
      "- Warning: could not determine HOME to update Gemini settings. Manually set experimental.plan=true in ~/.gemini/settings.json\n"
    );
    return;
  }

  const settingsDir = join(home, ".gemini");
  const settingsPath = join(settingsDir, "settings.json");
  const writeWarning = (): void => {
    process.stderr.write(
      `- Warning: could not update Gemini plan mode settings at ${settingsPath}. Manually set experimental.plan=true in ~/.gemini/settings.json\n`
    );
  };

  if (!existsSync(settingsPath)) {
    try {
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(settingsPath, `${JSON.stringify({ experimental: { plan: true } }, null, 2)}\n`, "utf-8");
    } catch {
      writeWarning();
    }
    return;
  }

  try {
    const raw = readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      writeWarning();
      return;
    }

    const root = parsed as Record<string, unknown>;
    const existingExperimental = root.experimental;
    const experimental =
      typeof existingExperimental === "object" && existingExperimental !== null && !Array.isArray(existingExperimental)
        ? (existingExperimental as Record<string, unknown>)
        : {};
    const next = {
      ...root,
      experimental: {
        ...experimental,
        plan: true,
      },
    };
    writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  } catch {
    writeWarning();
  }
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
    const geminiDefault = state.isInstalled ? state.hasGeminiCliProviderCatalog : true;
    const claudeDefault = state.isInstalled ? false : true;

    let enableChatGPT = resolveToggle(parsedArgs.value.chatgpt, chatgptDefault);
    let enableGemini = resolveToggle(parsedArgs.value.gemini, geminiDefault);
    let enableClaude = resolveToggle(parsedArgs.value.claude, claudeDefault);
    const enableModelCli = enableGemini || enableClaude;
    const seedClaudeModels =
      parsedArgs.value.claude === "no"
        ? false
        : state.isInstalled && enableModelCli
          ? true
          : enableClaude;
    const shouldBootstrapCli = resolveToggle(parsedArgs.value.bootstrap, !state.isInstalled);

    const canUseTui = !parsedArgs.value.noTui && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (parsedArgs.value.bootstrap === "yes" && !canUseTui) {
      process.stderr.write(
        "Bootstrap requires interactive TTY and --no-tui must be off. Re-run in a TTY without --no-tui or use --bootstrap=no.\n"
      );
      return 1;
    }

    const shouldPromptChatGPT = canUseTui && parsedArgs.value.chatgpt === "auto";
    const shouldPromptGemini = canUseTui && !state.isInstalled && parsedArgs.value.gemini === "auto";
    const shouldPromptClaude = canUseTui && !state.isInstalled && parsedArgs.value.claude === "auto";

    const promptSteps = Number(shouldPromptChatGPT) + Number(shouldPromptGemini) + Number(shouldPromptClaude);
    const totalSteps = 4 + promptSteps;
    let step = 1;

    if (canUseTui) {
      if (shouldPromptChatGPT) {
        printStep(step++, totalSteps, "Selecting OpenAI Codex integration...");
        enableChatGPT = await promptYesNo("Enable OpenAI Codex integration?", chatgptDefault);
      }
      if (shouldPromptGemini) {
        printStep(step++, totalSteps, "Selecting Gemini CLI integration...");
        enableGemini = await promptYesNo("Enable Gemini CLI integration?", true);
      }
      if (shouldPromptClaude) {
        printStep(step++, totalSteps, "Selecting Claude Code CLI tool integration...");
        enableClaude = await promptYesNo("Enable Claude Code CLI tool integration?", true);
      }
    }

    printStep(step++, totalSteps, "Resolving oh-my-Aegis npm plugin tag...");
    const pluginEntry = `${PACKAGE_NAME}@latest`;

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
      openAICodexAuthPluginEntry,
      ensureAntigravityAuthPlugin: false,
      ensureGeminiCliProviderCatalog: enableModelCli,
      modelCliSeed: {
        gemini: enableGemini,
        claude: seedClaudeModels,
      },
      ensureGoogleProviderCatalog: false,
      ensureOpenAICodexAuthPlugin: enableChatGPT,
      ensureOpenAIProviderCatalog: enableChatGPT,
    });

    if (enableGemini) {
      ensureGeminiExperimentalPlanEnabled();
    }

    let bootstrapFailed = false;
    const bootstrapAllowed = shouldBootstrapCli && canUseTui;
    if (bootstrapAllowed) {
      const npmAvailable = await installCliRuntime.commandExists("npm");

      if (enableGemini) {
        const geminiInstall = await ensureCliInstalledWithNpm(
          installCliRuntime,
          "gemini",
          "@google/gemini-cli",
          npmAvailable
        );
        if (!geminiInstall.ok) {
          bootstrapFailed = true;
        } else if (!(await runCliLoginFlow(installCliRuntime, "gemini"))) {
          bootstrapFailed = true;
        }
      }

      if (enableClaude) {
        const claudeInstall = await ensureCliInstalledWithNpm(
          installCliRuntime,
          "claude",
          "@anthropic-ai/claude-code",
          npmAvailable
        );
        if (!claudeInstall.ok) {
          bootstrapFailed = true;
        } else if (!(await runCliLoginFlow(installCliRuntime, "claude"))) {
          bootstrapFailed = true;
        }
      }
    }

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
      `- ensured provider catalogs: ${[enableModelCli ? "model_cli" : null, enableChatGPT ? "openai" : null].filter(Boolean).join(", ") || "(none)"}`,
      enableGemini ? "- Gemini CLI integration: enabled" : "- Gemini CLI integration: disabled",
      enableGemini ? "- Gemini CLI setup: install `gemini` CLI, then run `gemini` once to complete login (cached login can be reused)" : null,
      enableGemini ? "- Gemini CLI auth option: set GOOGLE_GENAI_USE_GCA=true to use cached Google CLI auth" : null,
      enableClaude
        ? "- Claude Code CLI integration: enabled (provider route available via model_cli/claude-*; tool still available)"
        : "- Claude Code CLI integration: disabled",
      enableClaude ? "- Claude CLI setup: install `claude` CLI, then run `claude` (or `claude login`) and follow prompts" : null,
      "- verify with: ctf_orch_readiness",
    ].filter(Boolean);
    process.stdout.write(`${lines.join("\n")}\n`);
    if (parsedArgs.value.bootstrap === "yes" && bootstrapFailed) {
      process.stderr.write("Bootstrap was required (--bootstrap=yes) but one or more bootstrap steps failed.\n");
      return 1;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`oh-my-Aegis install failed: ${message}\n`);
    return 1;
  }
}
