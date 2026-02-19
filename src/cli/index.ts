#!/usr/bin/env bun

import { runInstall } from "./install";
import { runDoctor } from "./doctor";
import { runReadiness } from "./readiness";
import { runAegis } from "./run";
import { runGetLocalVersion } from "./get-local-version";

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
    "  get-local-version  Show local/latest package version and install entry",
    "  version   Show package version",
    "  help      Show this help",
    "",
    "Examples:",
    "  bunx oh-my-aegis install",
    "  npx oh-my-aegis install",
    "  bunx oh-my-aegis run --mode=CTF \"solve this challenge\"",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const [command, ...commandArgs] = process.argv.slice(2);

switch (command) {
  case "install":
    process.exitCode = await runInstall(commandArgs);
    break;
  case "run":
    process.exitCode = await runAegis(commandArgs);
    break;
  case "doctor": {
    const report = runDoctor(process.cwd());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
