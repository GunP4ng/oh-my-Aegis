# Perfect Readiness Roadmap

This roadmap translates "universal CTF/BOUNTY orchestrator" into concrete engineering milestones.

## Readiness Definition

`oh-my-Aegis` is considered "perfect-ready" when all conditions below are true:

1. Runtime-enforced orchestration policy exists (not docs-only) for safety, verification, and loop discipline.
2. Domain routing and execution guidance are explicit for each target (`WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`).
3. Readiness diagnostics fail hard on critical misconfiguration.
4. End-to-end integration tests validate hook chains and failover behavior.
5. Domain benchmark scoring exists and can gate release quality.

## Milestone Breakdown

## M1 — Domain Playbook Injection
- **Goal**: every `task` call gets target-aware CTF/BOUNTY execution guidance.
- **Files**:
  - `src/orchestration/playbook.ts`
  - `src/index.ts`
- **Acceptance tests**:
  - `test/plugin-hooks.test.ts` verifies prompt contains `[oh-my-Aegis domain-playbook]` and `target=<...>`.

## M2 — Runtime Policy Enforcement
- **Goal**: convert policy-only rules to runtime checks where feasible.
- **Files**:
  - `src/risk/sanitize.ts` (prompt-injection indicator detection)
  - `src/state/notes-store.ts` (injection-attempt logging)
  - `src/index.ts` (`todowrite` one-`in_progress` guard + injection logging hook)
  - `src/config/schema.ts` (policy toggles)
- **Acceptance tests**:
  - `test/plugin-hooks.test.ts` blocks invalid `todowrite` payload with multiple `in_progress`.
  - `test/plugin-hooks.test.ts` confirms injection attempts are recorded in `.Aegis/SCAN.md`.
  - `test/risk-policy.test.ts` validates injection indicator detection.

## M3 — Strict Readiness Diagnostics
- **Goal**: readiness is fail-closed by default for missing/unreadable config and required mappings.
- **Files**:
  - `src/config/readiness.ts`
  - `src/config/schema.ts`
  - `src/tools/control-tools.ts`
- **Acceptance tests**:
  - `test/readiness.test.ts` strict mode fails when OpenCode config is missing.
  - `test/readiness.test.ts` relaxed mode warns-only when strict mode is disabled.

## M4 — Baseline MCP + Cross-Platform Config Paths
- **Goal**: minimal MCP baseline and config lookup works on Linux/Windows.
- **Files**:
  - `src/mcp/*`
  - `src/config/loader.ts`
  - `scripts/apply.ts`
- **Acceptance tests**:
  - `test/mcp-config.test.ts` validates builtin MCP injection and disable list.
  - Apply smoke confirms `context7` and `grep_app` are present in generated `opencode.json`.

## M5 — Benchmark-Driven Quality Gate
- **Goal**: score domain outcomes with explicit quality gate before claiming universal readiness.
- **Files**:
  - `src/benchmark/scoring.ts`
  - `scripts/benchmark-score.ts`
  - `benchmarks/manifest.example.json`
  - `package.json`
- **Acceptance tests**:
  - `test/benchmark-scoring.test.ts` validates perfect/needs_work verdict logic.

## M6 — Integration/E2E Maturity
- **Goal**: full hook-chain confidence for runtime behavior and benchmark evidence traceability.
- **Delivered**:
  - Dedicated e2e harness for `chat.message -> tool.execute.before/after` flow (`test/e2e-orchestration.test.ts`).
  - Domain fixture benchmark pack with per-domain evidence artifacts (`benchmarks/fixtures/domain-fixtures.json`, `scripts/benchmark-generate.ts`).
  - Fixture coverage gate requiring all domains across both `CTF` and `BOUNTY` modes.
  - CI now generates benchmark evidence before scoring (`.github/workflows/ci.yml`).
- **Success criteria**:
  - Deterministic pass in CI with per-domain evidence artifacts.

## M7 — Release/Operations Hardening
- **Goal**: convert validated builds into repeatable, production-grade releases.
- **Delivered**:
  - Cross-platform CI matrix (`ubuntu`, `macos`, `windows`) with per-OS apply smoke checks.
  - Release workflow with semver bump, changelog generation, tag creation, and GitHub Release publishing.
  - `doctor` command for pre-release runtime/build/readiness/benchmark diagnostics.
- **Success criteria**:
  - `publish` workflow can produce tagged release from a clean mainline commit.
  - Doctor check is green before release creation.

## Release Gate (minimum)

Before calling the orchestrator "perfect-ready":

1. `bun run typecheck` passes.
2. `bun test` passes.
3. `bun run build` passes.
4. `bun run apply` smoke passes on isolated config path.
5. `bun run benchmark:score <results.json>` returns `qualityGate.verdict = "perfect"`.
