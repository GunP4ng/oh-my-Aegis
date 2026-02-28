import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPlaybookRegistry,
  parsePlaybookFile,
  parsePlaybookRegistry,
  resetPlaybookRegistryCacheForTests,
  resolvePlaybooksRoot,
} from "../src/orchestration/playbook-loader";

describe("playbook-loader", () => {
  it("validates schema and rejects malformed playbook registry", () => {
    expect(() =>
      parsePlaybookRegistry({
        version: 1,
        base_rules: [
          {
            id: "broken",
            order: 1,
            lines: ["x"],
          },
        ],
        conditional_rules: [],
      })
    ).toThrow();
  });

  it("loads with deterministic rule ordering", () => {
    resetPlaybookRegistryCacheForTests();
    const first = loadPlaybookRegistry();
    resetPlaybookRegistryCacheForTests();
    const second = loadPlaybookRegistry();

    expect(first).toEqual(second);
    const baseKeys = first.base_rules.map((rule) => `${String(rule.order).padStart(4, "0")}:${rule.id}`);
    const conditionalKeys = first.conditional_rules.map((rule) => `${String(rule.order).padStart(4, "0")}:${rule.id}`);
    expect(baseKeys).toEqual([...baseKeys].sort());
    expect(conditionalKeys).toEqual([...conditionalKeys].sort());
  });

  it("resolves playbooks root from src/orchestration base dir", () => {
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    const srcBase = join(repoRoot, "src", "orchestration");
    const resolved = resolvePlaybooksRoot(srcBase);
    expect(resolved).toBe(join(repoRoot, "playbooks"));
    expect(resolved.endsWith(`${sep}playbooks`)).toBe(true);
  });

  it("resolves playbooks root from dist base dir", () => {
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    const distBase = join(repoRoot, "dist");
    const resolved = resolvePlaybooksRoot(distBase);
    expect(resolved).toBe(join(repoRoot, "playbooks"));
    expect(resolved.endsWith(`${sep}playbooks`)).toBe(true);
  });

  it("throws clear error when no playbooks candidate exists", () => {
    const isolated = mkdtempSync(join(tmpdir(), "playbook-loader-test-"));
    const badBase = join(isolated, "src", "orchestration");
    expect(() => resolvePlaybooksRoot(badBase)).toThrow("failed to resolve playbooks directory");
  });

  it("parses YAML-native playbook syntax", () => {
    const isolated = mkdtempSync(join(tmpdir(), "playbook-loader-yaml-"));
    const yamlPath = join(isolated, "yaml-syntax-playbook.yaml");
    writeFileSync(
      yamlPath,
      [
        "version: 1",
        "base_rules:",
        "  - id: yaml-rule",
        "    order: 7",
        "    lines:",
        "      - yaml-line",
        "    trigger: {}",
        "    state_mutation: {}",
        "    mandatory_next_action:",
        "      route: ctf-web",
        "conditional_rules: []",
      ].join("\n")
    );

    const registry = parsePlaybookFile(yamlPath);
    expect(registry.version).toBe(1);
    expect(registry.base_rules).toHaveLength(1);
    expect(registry.base_rules[0]?.id).toBe("yaml-rule");
    expect(registry.base_rules[0]?.mandatory_next_action.route).toBe("ctf-web");
  });
});
