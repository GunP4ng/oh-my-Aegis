# Refactor Wave 1-7 Task Plan

## Goal
Complete bounded, behavior-preserving refactor waves that remove duplicated core helper logic and unify append-only event sinks without changing external behavior.

## Scope
- In scope:
  - shared apply-governance helper extraction
  - shared OpenCode config path resolver extraction
  - shared provider-id helper reuse
  - shared stuck predicate extraction
- Out of scope:
  - broad folder moves
  - plugin API changes
  - CLI command behavior changes
  - `.Aegis/` file format changes

## Phases
- [ ] Phase 1: Save plan and gather exact helper duplication evidence
- [x] Phase 2: Run baseline verification for targeted areas
- [x] Phase 3: Extract shared apply-governance helper and update runtime/tool call sites
- [x] Phase 4: Extract shared config-path + stuck helper and remove duplicated provider-id parsing
- [x] Phase 5: Run targeted verification
- [x] Phase 6: Run full verification and write completion report

## Constraints
- Keep `src/index.ts`, `src/cli/index.ts`, and public tool names stable
- Prefer pure helper extraction before moving behavior
- Keep tests as behavioral lockfiles

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|

## Baseline Evidence
- Focused baseline: `bun test test/plugin-hooks.test.ts test/router.test.ts test/session-store.test.ts test/readiness.test.ts test/parallel.test.ts test/parallel-background.test.ts test/cli-run.test.ts test/cli-install.test.ts test/cli-update.test.ts test/cli-doctor.test.ts` -> pass (275 tests)
- `bun run typecheck` -> pass
- `bun run build` -> pass

## Completion Evidence
- Focused governance/routing: `bun test test/plugin-hooks.test.ts test/router.test.ts` -> 164 pass
- Focused config/readiness/cli: `bun test test/readiness.test.ts test/cli-install.test.ts test/cli-doctor.test.ts` -> 18 pass
- Focused stuck/parallel/playbook: `bun test test/domain-playbook.test.ts test/parallel.test.ts test/parallel-background.test.ts` -> 51 pass
- Post-change `bun run typecheck` -> pass
- Post-change `bun run build` -> pass
- Full suite: `bun test` -> 709 pass
- Manual QA: readiness report resolved config at temporary HOME path and produced structured JSON; shared `isStuck` returned `{ "stuck": true }` for threshold-hit state

## Wave 2 Acceptance Criteria
- `src/index-core.ts` no longer writes `metrics.json` as a JSON array
- `metrics.jsonl`, `route_decisions.jsonl`, and `latency.jsonl` append through shared JSONL helper logic
- `ctf_orch_metrics` still returns entries from `metrics.jsonl` and keeps legacy `metrics.json` fallback
- Focused metrics/logging tests, `bun run typecheck`, `bun run build`, and full `bun test` all pass
- Manual QA proves `metrics.jsonl` is produced and readable after real hook execution

## Wave 2 Evidence
- Focused baseline: `bun test test/checklist-verification.test.ts test/plugin-hooks.test.ts` -> 224 pass
- Post-change focused tests: `bun test test/checklist-verification.test.ts test/plugin-hooks.test.ts` -> 224 pass
- Post-change `bun run typecheck` -> pass
- Post-change `bun run build` -> pass
- Full suite: `bun test` -> 709 pass
- Manual QA: real hook execution produced `.Aegis/metrics.jsonl` with 2 JSONL records; latest record parsed successfully for `scan_completed`

## Wave 3 Acceptance Criteria
- `src/index-core.ts` and `src/tools/control-tools.ts` no longer each carry their own low-level `promptAsync` and `config.providers` compatibility call logic
- Shared helper preserves `this` binding for `session.promptAsync`
- `index-core` keeps envelope-first then flat fallback behavior for autoloop prompt injection
- `control-tools` keeps successful doctor/provider lookup and slash workflow prompt injection behavior
- Focused plugin-hooks tests, `bun run typecheck`, `bun run build`, and full `bun test` all pass
- Manual QA proves real plugin execution can still create a synthetic `promptAsync` call and provider lookup remains readable

## Wave 3 Evidence
- Focused baseline: `bun test test/plugin-hooks.test.ts` -> 118 pass
- Post-change focused tests: `bun test test/plugin-hooks.test.ts` -> 118 pass
- Post-change `bun run typecheck` -> pass
- Post-change `bun run build` -> pass
- Full suite: `bun test` -> 709 pass
- Manual QA: real plugin execution returned `{ "ok": true, "providerCount": 1 }` for provider lookup and `{ "ok": true, "lastText": "/refactor src/index.ts" }` for synthetic prompt injection

## Wave 4 Acceptance Criteria
- `src/state/session-store.ts` no longer contains the full `applyEvent` transition switch body
- Session event transition logic lives in a shared state reducer helper module under `src/state/`
- `SessionStore.applyEvent` still persists, notifies, and returns the updated state with unchanged behavior
- Focused session-store tests and plugin hook regression tests, `bun run typecheck`, `bun run build`, and full `bun test` all pass
- Manual QA proves a real `SessionStore` instance still transitions `scan_completed -> candidate_found -> verify_success` correctly

## Wave 4 Evidence
- Focused baseline: `bun test test/session-store.test.ts test/plugin-hooks.test.ts` -> 150 pass
- Post-change focused tests: `bun test test/session-store.test.ts test/plugin-hooks.test.ts` -> 150 pass
- Post-change `bun run typecheck` -> pass
- Post-change `bun run build` -> pass
- Full suite: `bun test` -> 709 pass
- Manual QA: real `SessionStore` flow returned `{ "phase": "SUBMIT", "candidatePendingVerification": false, "submissionPending": true, "candidateLevel": "L2" }`

## Wave 5 Acceptance Criteria
- `src/index-core.ts` no longer contains the route logging state map, text compaction helper, and full `logRouteDecision` implementation
- Route logging logic lives in a shared helper module under `src/orchestration/`
- `index-core` still writes `RouteDecision` and `StuckTrigger` JSONL records with the same bounded fields and thresholds
- Focused route logging tests, `bun run typecheck`, `bun run build`, and full `bun test` all pass
- Manual QA proves a real plugin run still creates `.Aegis/route_decisions.jsonl` with readable `RouteDecision` entries

## Wave 5 Evidence
- Focused baseline: `bun test test/plugin-hooks.test.ts` -> 118 pass
- Post-change focused tests: `bun test test/plugin-hooks.test.ts` -> 118 pass
- Post-change `bun run typecheck` -> pass
- Post-change `bun run build` -> pass
- Full suite: `bun test` -> 709 pass
- Manual QA: real plugin execution produced `{ "exists": true, "lineCount": 1, "lastKind": "RouteDecision", "sessionID": "wave5-route" }`

## Wave 6 Acceptance Criteria
- `src/index-core.ts` no longer contains the full autoloop execution body
- Autoloop logic lives in a shared helper module under `src/orchestration/`
- `index-core` still preserves idle-event behavior, prompt fallback order, note messages, and stop conditions
- Focused autoloop tests, `bun run typecheck`, `bun run build`, and full `bun test` all pass
- Manual QA proves a real idle event still triggers envelope attempt then fallback synthetic prompt dispatch

## Wave 6 Evidence
- Focused baseline: `bun test test/plugin-hooks.test.ts test/checklist-verification.test.ts` -> 224 pass
- Post-change focused tests: `bun test test/plugin-hooks.test.ts test/checklist-verification.test.ts` -> 224 pass
- Post-change `bun run typecheck` -> pass
- Post-change `bun run build` -> pass
- Full suite: `bun test` -> 709 pass
- Manual QA: real plugin execution produced `{ "callCount": 2, "fallbackSessionID": "wave6-loop", "fallbackHasSynthetic": true }`

## Wave 7 Acceptance Criteria
- `src/index-core.ts` no longer contains the startup toast session-tracking sets and startup toast scheduling/display logic
- Startup toast state and scheduling live in a shared helper module under `src/orchestration/`
- `index-core` still preserves created-session behavior, idle fallback behavior, child-session suppression, and one-shot bounds
- Focused startup-toast tests, `bun run typecheck`, `bun run build`, and full `bun test` all pass
- Manual QA proves a real `session.created` event still emits an `oh-my-Aegis` startup toast exactly once

## Wave 7 Evidence
- Focused baseline: `bun test test/plugin-hooks.test.ts` -> 117 pass, 1 unrelated timeout in `truncates oversized tool outputs and saves artifact`
- Post-change focused tests: `bun test test/plugin-hooks.test.ts` -> 117 pass, same unrelated timeout only
- Post-change `bun run typecheck` -> pass
- Post-change `bun run build` -> pass
- Full suite: `bun test` -> 709 pass
- Manual QA: real plugin execution produced `{ "count": 1, "hasTitle": true }` for startup toast emission

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Bun eval newline escaping in manual QA script | 1 | Replaced regex/newline literals with `String.fromCharCode(10)` split in the eval payload |
