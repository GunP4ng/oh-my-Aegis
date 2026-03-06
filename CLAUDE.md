# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install          # Install dependencies
bun run typecheck    # TypeScript strict type check (no emit)
bun test             # Run all tests
bun test <file>      # Run a single test file
bun test -t "<pat>"  # Run tests matching a name pattern
bun run build        # Build dist/ (tsc declarations + bun bundle + CLI)
bun run apply        # Bootstrap/apply configuration to OpenCode
bun run setup        # install + apply
bun run doctor       # Local diagnostics (build, readiness, benchmarks)
```

**Quality gate before commits:** `bun run typecheck && bun test && bun run build && git diff --exit-code -- dist`

## Architecture

oh-my-Aegis is an [OpenCode](https://opencode.ai) plugin that orchestrates automated CTF and Bug Bounty solving workflows. It hooks into OpenCode's message/tool pipeline to drive a multi-phase state machine using specialized sub-agents.

### Plugin Entry & Hook Pipeline

`src/index-core.ts` is the main plugin (~154KB). It registers three OpenCode hooks:
- `chat.message` — Injects MODE headers, detects target type
- `tool.execute.before` — Routes tasks, enforces bash policies, triggers governance gates
- `tool.execute.after` — Classifies failures, collects evidence
- `experimental.chat.system.transform` — Injects phase/signal guidance into system prompts

### State Machine (`src/state/session-store.ts`)

Phases: `SCAN → PLAN → EXECUTE → VERIFY → SUBMIT`
Modes: `CTF` | `BOUNTY`
Targets: `WEB_API | WEB3 | PWN | REV | CRYPTO | FORENSICS | MISC | UNKNOWN`
Evidence levels: `L0` (candidate) → `L1` (likely) → `L2` (verified) → `L3` (accepted)

Key transitions: `scan_completed`→PLAN, `plan_completed`→EXECUTE, `verify_success`→SUBMIT, `verify_fail`→EXECUTE (loops with mismatch counter), `submit_rejected`→EXECUTE.

### Routing Engine (`src/orchestration/router.ts`)

Selects the sub-agent to dispatch based on priority order:
1. Context/timeout overflow → `md-scribe`
2. Bounty scope unconfirmed → `bounty-scope`
3. Governance phase → patch proposal/review/apply/audit routes
4. Static-dynamic contradictions → extraction-first pivot
5. Stale pattern / no-evidence loop → hypothesis routes
6. Candidate ready → `ctf-decoy-check` / `ctf-verify` fast paths
7. Bounty inconclusive → `bounty-research`
8. Stuck detection → domain-specific stuck routes
9. Phase + target → domain subagent (e.g., `ctf-web` for WEB_API in SCAN)

### Sub-agents (`src/agents/`)

17 specialized agents: CTF domain agents (`ctf-web`, `ctf-web3`, `ctf-pwn`, `ctf-rev`, `ctf-crypto`, `ctf-forensics`, `ctf-explore`), shared orchestration agents (`aegis-plan`, `aegis-exec`, `aegis-deep`, `aegis-explore`, `aegis-librarian`), bounty agents (`bounty-scope`, `bounty-triage`, `bounty-research`), and utilities (`md-scribe`). Each has domain-specific system prompts and permission profiles.

### Governance Pipeline

4-stage flow managed in `src/orchestration/patch-boundary.ts`, `review-gate.ts`, `apply-lock.ts`, `council-policy.ts`:

`PROPOSE → REVIEW → COUNCIL → APPLY`

Artifacts stored under `.Aegis/runs/<run_id>/` with cryptographic digest binding for chain-of-custody. A single-writer lock enforces atomic apply.

### Evidence & Verification (`src/orchestration/evidence-ledger.ts`)

Hard gates for `verify_success`:
- CTF: Oracle + ExitCode0 + ParityEvidence required
- BOUNTY: Minimal-impact read-only + scope validation

Domain-specific checklists enforced via playbooks (YAML in `playbooks/`).

### Control Tools (`src/tools/control-tools.ts`)

80+ OpenCode tools prefixed `ctf_` / `aegis_`: orchestration control (`ctf_orch_set_mode`, `ctf_orch_event`), phase management (`ctf_flag_candidate`, `ctf_verify`), parallel dispatch (`ctf_parallel_dispatch`, `ctf_parallel_collect`), governance (`ctf_patch_propose` → `ctf_patch_apply`), analysis (`ctf_risk_score`, `ctf_libc_lookup`, `ctf_delta_scan`).

### Persistence (`src/state/notes-store.ts`)

Notes written to `.Aegis/` in the working directory:
- `STATE.md` — Goals, constraints, environment, pending TODOs
- `WORKLOG.md` — Attempts, observations, summaries
- `EVIDENCE.md` — Verified facts only
- `artifacts/` — Raw outputs, logs, scripts

### Configuration (`src/config/schema.ts`, `src/config/loader.ts`)

Zod-validated schema with runtime defaults + user overrides. Supports lane model profiles (user → session override → lane → fallback), provider catalog migrations, and skill autoload rules driven by MODE/PHASE/TARGET.

## Code Conventions

- **ESM only** (`"type": "module"`) — all imports use explicit `.js` extensions in output
- **Node builtins:** `import { x } from "node:fs"` (node: prefix required)
- **Type imports:** `import type { X } from "..."` separated from value imports
- **Error returns:** structured `{ ok: false, reason: string }` — tools return JSON, no throws
- **Fail-closed:** governance and risk paths must deterministically report all precondition failures
- Test files live in `test/*.test.ts`; use temp directories for isolation, not mocks of internal state

## Key Docs

- `docs/runtime-workflow.md` — Full state machine, hook pipeline, routing priorities
- `docs/ctf-bounty-contract.md` — Operational rules, evidence criteria, governance contracts
- `docs/standalone-orchestrator.md` — Product boundary, CLI interface, provider strategy
- `AGENTS.md` — Contributor guidelines (Korean)
