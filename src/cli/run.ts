import { spawn } from "node:child_process";

type Mode = "CTF" | "BOUNTY";

interface ParsedRunArgs {
  help: boolean;
  mode: Mode;
  ultrawork: boolean;
  message: string;
  passthrough: string[];
}

export function printRunHelp(): void {
  const lines = [
    "Usage:",
    "  oh-my-aegis run [--mode=<CTF|BOUNTY>] [--ultrawork] <message> [-- <opencode run args>]",
    "",
    "Examples:",
    "  oh-my-aegis run --mode=CTF \"solve this rev challenge\"",
    "  oh-my-aegis run --ultrawork \"triage this bounty target\" -- --session-id ses_xxx",
    "",
    "Notes:",
    "  - automatically prepends MODE header when missing",
    "  - optionally injects ultrawork keyword when --ultrawork is used",
    "  - forwards args after '--' to 'opencode run'",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

function parseMode(value: string): Mode | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CTF" || normalized === "BOUNTY") return normalized;
  return null;
}

function parseRunArgs(args: string[]): { ok: true; value: ParsedRunArgs } | { ok: false; error: string } {
  let mode: Mode = "BOUNTY";
  let ultrawork = false;
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
      message,
      passthrough,
    },
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

  return await new Promise<number>((resolve) => {
    const child = spawn("opencode", ["run", message, ...parsed.value.passthrough], {
      stdio: "inherit",
      env: process.env,
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
