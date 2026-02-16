#!/usr/bin/env bun

import { printInstallHelp, runInstall } from "./install";
import { runDoctor } from "./doctor";
import { runReadiness } from "./readiness";

const packageJson = await import("../../package.json");
const VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

function printHelp(): void {
  const lines = [
    "oh-my-aegis CLI",
    "",
    "Commands:",
    "  install   Register package plugin and bootstrap config",
    "  doctor    Run local checks (build/readiness/benchmarks)",
    "  readiness Run readiness report (JSON)",
    "  version   Show package version",
    "  help      Show this help",
    "",
    "Examples:",
    "  bunx oh-my-aegis install",
    "  npx oh-my-aegis install",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

const [command] = process.argv.slice(2);

switch (command) {
  case "install":
    process.exitCode = runInstall();
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
    printInstallHelp();
    process.exitCode = 1;
    break;
}
