#!/usr/bin/env bun

import { runInstall } from "./install";
import { formatDoctorReport, runDoctor } from "./doctor";
import { runReadiness } from "./readiness";
import { runAegis } from "./run";
import { runGetLocalVersion } from "./get-local-version";
import { maybeAutoUpdate, runUpdate } from "./update";
import { runFlowWatch } from "./flow-watch";

const packageJson = await import("../../package.json");
const VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

function printHelp(): void {
  const lines = [
    "oh-my-aegis CLI",
    "",
    "Commands:",
    "  install   Register package plugin and bootstrap config",
    "  run       Run OpenCode with Aegis mode header bootstrap",
    "  doctor    Run local checks (build/readiness/benchmarks)",
    "  readiness Run readiness report (JSON)",
    "  update    Check git updates and auto-apply when behind",
    "  flow      Show live agent workflow chart (tmux panel)",
    "  get-local-version  Show local/latest package version and install entry",
    "  version   Show package version",
    "  help      Show this help",
    "",
    "Examples:",
    "  bunx oh-my-aegis install",
    "  npx oh-my-aegis install",
    "  bunx oh-my-aegis run --mode=CTF \"solve this challenge\"",
    "  oh-my-aegis flow --watch /path/to/.Aegis/FLOW.json",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const [command, ...commandArgs] = process.argv.slice(2);

const autoUpdateAllowedCommands = new Set([
  "install",
  "run",
  "doctor",
  "readiness",
  "get-local-version",
]);

if (command && autoUpdateAllowedCommands.has(command)) {
  await maybeAutoUpdate();
}

switch (command) {
  case "install":
    process.exitCode = await runInstall(commandArgs);
    break;
  case "run":
    process.exitCode = await runAegis(commandArgs);
    break;
  case "doctor": {
    const json = commandArgs.includes("--json");
    const report = runDoctor(process.cwd());
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatDoctorReport(report)}\n`);
    }
    if (!report.ok) process.exitCode = 2;
    break;
  }
  case "readiness": {
    const report = runReadiness(process.cwd());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    break;
  }
  case "get-local-version":
    process.exitCode = await runGetLocalVersion(commandArgs);
    break;
  case "update":
    process.exitCode = await runUpdate(commandArgs);
    break;
  case "flow":
    process.exitCode = await runFlowWatch(commandArgs);
    break;
  case "version":
  case "-v":
  case "--version":
    process.stdout.write(`oh-my-aegis v${VERSION}\n`);
    break;
  case "help":
  case "-h":
  case "--help":
    printHelp();
    break;
  default:
    if (!command) {
      printHelp();
      break;
    }
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printHelp();
    process.exitCode = 1;
    break;
}
