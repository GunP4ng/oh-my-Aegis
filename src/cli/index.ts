#!/usr/bin/env bun

import { printInstallHelp, runInstall } from "./install";

const packageJson = await import("../../package.json");
const VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

function printHelp(): void {
  const lines = [
    "oh-my-aegis CLI",
    "",
    "Commands:",
    "  install   Register package plugin and bootstrap config",
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
