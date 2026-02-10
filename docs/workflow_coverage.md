# AGENTS.md Coverage Matrix (oh-my-Aegis)

Source policy reference: `~/.config/opencode/AGENTS.md`

This file tracks how CTF/BOUNTY workflow policy is represented in `oh-my-Aegis`.

## Covered in Code

- Mode gate (`CTF`/`BOUNTY`) and default fallback to `BOUNTY`.
- Phase routing (`SCAN -> PLAN -> EXECUTE`) with stuck escalation.
- Candidate verification gate (`ctf-decoy-check -> ctf-verify`).
- Bounty scope-first behavior and read-only pre-scope bash policy.
- Failover signature mapping (`explore/librarian/oracle` -> `*-fallback`).
- Target-aware domain playbook injection on dispatched `task` prompts.
- Prompt-injection indicator detection and `INJECTION-ATTEMPT` logging to `.Aegis/SCAN.md`.
- `todowrite` guardrail enforcing max one `in_progress` item.
- CTF fast-verify path for low-risk candidates (decoy-check still enforced for risky/ambiguous conditions).
- Non-security hook/runtime failures are fail-open with best-effort logging.
- Failure-reason classification and adaptive routing hooks for repeated unsolved states.
- Markdown budget controls + archive rotation for `.Aegis` notes.
- Target-aware CTF routing for `WEB_API`, `WEB3`, `PWN`, `REV`, `CRYPTO`, `FORENSICS`, `MISC`, `UNKNOWN`.
- `OSINT` is intentionally routed via `MISC` classification.
- One-command apply flow (`bun run setup` / `bun run apply`) that patches OpenCode plugin and required subagents.
- Minimal built-in MCP baseline (`context7`, `grep_app`) with runtime config injection and apply-time ensure.
- Readiness report includes per-target missing subagent coverage (`coverageByTarget`).
- Readiness report includes missing built-in MCP mappings.
- Benchmark quality gate enforces evidence-backed runs (non-skip entries require existing evidence files).
- Domain fixture benchmark generator creates reproducible `results.json` + per-domain evidence artifacts.
- Fixture generator enforces dual-mode coverage (every domain appears in both CTF and BOUNTY fixture sets).
- Release automation now includes semver bump, changelog generation, git tagging, and GitHub release workflow.
- CI now validates across Linux/macOS/Windows with per-OS apply smoke checks.
- Doctor command validates runtime/build/readiness/benchmark health before release.

## Main Implementations

- `src/orchestration/router.ts`
  - route decisions + target-aware phase/stuck routing + failure-driven adaptation
- `src/orchestration/task-dispatch.ts`
  - route-to-subagent mapping + target-aware failover dispatch
- `src/state/session-store.ts`
  - state transitions and event counters
- `src/state/notes-store.ts`
  - STATE/WORKLOG/EVIDENCE/SCAN/CONTEXT_PACK persistence and rotation (WORKLOG/EVIDENCE/SCAN/CONTEXT_PACK rotate)
- `src/risk/policy-matrix.ts`
  - command guardrails for destructive and bounty pre-scope control
- `src/risk/sanitize.ts`
  - failure signal parsing + prompt-injection indicator detection
- `src/config/schema.ts`
  - failover, verification, markdown budget, target routing, capability profiles schema, built-in MCP toggles, strict/enforcement toggles
- `src/orchestration/playbook.ts`
  - per-target CTF/BOUNTY execution playbook text
- `src/mcp/index.ts`
  - built-in MCP registry and disable-list filtering
- `src/config/readiness.ts`
  - writable checks + required subagents + per-target coverage checks + MCP presence checks
- `src/tools/control-tools.ts`
  - operational tools (`status`, `event`, `next`, `failover`, `postmortem`, `check_budgets`, `compact`, `readiness`)
- `scripts/apply.ts`
  - one-command apply/update of `opencode.json` and `oh-my-Aegis.json`, including minimal built-in MCP mappings
- `scripts/benchmark-generate.ts`
  - executes domain fixture scenarios and materializes evidence artifacts + `benchmarks/results.json`
- `scripts/benchmark-score.ts`
  - validates domain score and evidence path existence for non-skip runs
- `scripts/doctor.ts`
  - environment diagnostics for runtime, build artifacts, readiness, and benchmark gate
- `scripts/release-version.ts`
  - semver bump/override logic for release automation
- `scripts/generate-changelog.ts`
  - release notes generation from git history

## Remaining Policy-Level Contracts

These are intentionally not fully hardcoded and remain operator/prompt discipline:

- exact reporting templates
- legal/authorization policy for bounty scope
- `.sisyphus` path contract (runtime storage currently uses `.Aegis`)
