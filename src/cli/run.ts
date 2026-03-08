import { spawn } from "node:child_process";

type Mode = "CTF" | "BOUNTY";

interface ParsedRunArgs {
  help: boolean;
  mode: Mode;
  ultrawork: boolean;
  godMode: boolean;
  message: string;
  passthrough: string[];
}

function parseCommandPassthrough(passthrough: string[]): string | null {
  for (let i = 0; i < passthrough.length; i += 1) {
    const arg = passthrough[i] ?? "";
    if (arg.startsWith("--command=")) {
      return arg.slice("--command=".length).trim() || null;
    }
    if (arg === "--command") {
      const next = passthrough[i + 1];
      if (typeof next === "string" && next.trim().length > 0) {
        return next.trim();
      }
      return null;
    }
    if (arg.startsWith("-c=")) {
      return arg.slice("-c=".length).trim() || null;
    }
    if (arg === "-c") {
      const next = passthrough[i + 1];
      if (typeof next === "string" && next.trim().length > 0) {
        return next.trim();
      }
      return null;
    }
  }

  return null;
}

export function validatePassthroughCommand(passthrough: string[]): string | null {
  const command = parseCommandPassthrough(passthrough);
  if (!command) return null;

  if (/^(ctf_|aegis_)/.test(command)) {
    return [
      `Invalid --command target: ${command}`,
      "--command expects a slash workflow command, not a tool name.",
      "Use normal run prompting for tools or ctf_orch_slash for slash workflows.",
    ].join(" ");
  }

  return null;
}

export function printRunHelp(): void {
  const lines = [
    "Usage:",
    "  oh-my-aegis run [--mode=<CTF|BOUNTY>] [--ultrawork] [--god-mode] <message> [-- <opencode run args>]",
    "",
    "Examples:",
    "  oh-my-aegis run --mode=CTF \"solve this rev challenge\"",
    "  oh-my-aegis run --ultrawork \"triage this bounty target\" -- --session-id ses_xxx",
    "  oh-my-aegis run --god-mode \"continue inside isolated VM\"",
    "  oh-my-aegis run --mode=CTF \"continue\" -- --command help",
    "",
    "Notes:",
    "  - automatically prepends MODE header when missing",
    "  - optionally injects ultrawork keyword when --ultrawork is used",
    "  - --god-mode/--unsafe-full-permission sets AEGIS_GOD_MODE=1 for the spawned run",
    "  - forwards args after '--' to 'opencode run'",
    "  - --command must be a slash workflow command (for example: help)",
    "  - tool names like ctf_orch_status/aegis_* are not valid --command targets",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseMode(value: string): Mode | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CTF" || normalized === "BOUNTY") return normalized;
  return null;
}

export function parseRunArgs(args: string[]): { ok: true; value: ParsedRunArgs } | { ok: false; error: string } {
  let mode: Mode = "BOUNTY";
  let ultrawork = false;
  let godMode = false;
  let help = false;
  const messageParts: string[] = [];
  const passthrough: string[] = [];
  let passThroughMode = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";

    if (passThroughMode) {
      passthrough.push(arg);
      continue;
    }

    if (arg === "--") {
      passThroughMode = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--ultrawork" || arg === "--ulw") {
      ultrawork = true;
      continue;
    }

    if (arg === "--god-mode" || arg === "--unsafe-full-permission") {
      godMode = true;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      const parsed = parseMode(arg.slice("--mode=".length));
      if (!parsed) return { ok: false, error: `Invalid --mode value: ${arg.slice("--mode=".length)}` };
      mode = parsed;
      continue;
    }

    if (arg === "--mode") {
      const next = args[i + 1];
      if (!next) {
        return { ok: false, error: "Missing value after --mode" };
      }
      const parsed = parseMode(next);
      if (!parsed) return { ok: false, error: `Invalid --mode value: ${next}` };
      mode = parsed;
      i += 1;
      continue;
    }

    messageParts.push(arg);
  }

  const message = messageParts.join(" ").trim();
  return {
    ok: true,
    value: {
      help,
      mode,
      ultrawork,
      godMode,
      message,
      passthrough,
    },
  };
}

export function buildRunEnv(baseEnv: NodeJS.ProcessEnv, godMode: boolean): NodeJS.ProcessEnv {
  if (!godMode) {
    return baseEnv;
  }
  return {
    ...baseEnv,
    AEGIS_GOD_MODE: "1",
  };
}

export function buildRunMessage(input: { mode: Mode; ultrawork: boolean; message: string }): string {
  const modeInjected = /\bMODE\s*:\s*(CTF|BOUNTY)\b/i.test(input.message)
    ? input.message
    : `MODE: ${input.mode}\n${input.message}`;
  if (!input.ultrawork) {
    return modeInjected;
  }
  return /\b(ultrawork|ulw)\b/i.test(modeInjected) ? modeInjected : `ulw\n${modeInjected}`;
}

export async function runAegis(commandArgs: string[] = []): Promise<number> {
  const parsed = parseRunArgs(commandArgs);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n\n`);
    printRunHelp();
    return 1;
  }
  if (parsed.value.help) {
    printRunHelp();
    return 0;
  }
  if (!parsed.value.message) {
    process.stderr.write("Missing run message.\n\n");
    printRunHelp();
    return 1;
  }

  const message = buildRunMessage({
    mode: parsed.value.mode,
    ultrawork: parsed.value.ultrawork,
    message: parsed.value.message,
  });

  const passthroughValidationError = validatePassthroughCommand(parsed.value.passthrough);
  if (passthroughValidationError) {
    process.stderr.write(`${passthroughValidationError}\n`);
    return 1;
  }

  return await new Promise<number>((resolve) => {
    const child = spawn("opencode", ["run", message, ...parsed.value.passthrough], {
      stdio: "inherit",
      env: buildRunEnv(process.env, parsed.value.godMode),
    });

    child.on("error", (error) => {
      process.stderr.write(`Failed to run opencode: ${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      if (signal) {
        process.stderr.write(`opencode terminated by signal: ${signal}\n`);
      }
      resolve(1);
    });
  });
}
