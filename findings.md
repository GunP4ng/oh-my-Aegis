# Findings

## Refactor Wave 1

- `src/index-core.ts` and `src/tools/control-tools.ts` both implement patch artifact chain checks, patch digest verification, and apply-governance prerequisite checks.
- `src/config/readiness.ts` and `src/install/apply-config.ts` both implement OpenCode config path lookup logic.
- Provider parsing helpers are duplicated in `src/config/readiness.ts`, `src/install/apply-config.ts`, `src/tools/control-tools.ts`, and `src/orchestration/parallel.ts`, while `src/orchestration/model-health.ts` already exports `providerIdFromModel`.
- Stuck detection logic is duplicated in `src/orchestration/router.ts` and `src/orchestration/playbook-engine.ts`.
- Verification surfaces for this wave are strong: `test/plugin-hooks.test.ts`, `test/router.test.ts`, `test/session-store.test.ts`, `test/parallel*.test.ts`, `test/readiness.test.ts`, `test/cli-*.test.ts`, plus full `bun test`, `bun run typecheck`, `bun run build`.

## Implemented

- Added `src/orchestration/apply-governance-helpers.ts` and switched `src/index-core.ts` plus `src/tools/control-tools.ts` to shared governance/apply prerequisite evaluation.
- Added `src/config/opencode-config-path.ts` and reused it from readiness/install callers.
- Reused `providerIdFromModel` from `src/orchestration/model-health.ts` in readiness/install/control-tools, while keeping `src/orchestration/parallel.ts`'s family-based wrapper intentionally intact.
- Added `src/orchestration/stuck.ts` and switched router/playbook-engine to the shared predicate.

## Refactor Wave 2

- `src/index-core.ts` writes orchestration metrics to `metrics.json` by reading/parsing/re-writing a JSON array.
- `src/tools/control-tools.ts` writes orchestration metrics to `metrics.jsonl` and already reads `metrics.jsonl` first with `metrics.json` fallback.
- `src/index-core.ts` also appends `latency.jsonl` and `route_decisions.jsonl` with direct `appendFileSync(JSON.stringify(...)+"\n")` logic.
- Existing tests already lock `metrics.jsonl` and `route_decisions.jsonl` behavior, so the safe change is to unify append-only JSONL writing behind a shared helper and move index-core metrics to JSONL.

## Wave 2 Implemented

- Added `src/orchestration/jsonl-sink.ts` with shared `appendJsonlRecord` and `appendJsonlRecords` helpers.
- Switched `src/index-core.ts` latency flush, orchestration metrics, and route decision logging to the shared JSONL sink.
- Migrated `src/index-core.ts` metrics writes from `metrics.json` array rewrites to `metrics.jsonl` append-only records.
- Switched `src/tools/control-tools.ts` metrics append to the shared JSONL sink while keeping `ctf_orch_metrics` read fallback to legacy `metrics.json` intact.

## Refactor Wave 3

- `src/index-core.ts` has a local `sendSessionPromptAsync` that binds `session.promptAsync` and tries two payload shapes.
- `src/tools/control-tools.ts` has local `callPromptAsync` and `callConfigProviders` wrappers that duplicate client capability checks and response validation.
- Existing tests already lock two critical behaviors: provider lookup success in `ctf_orch_doctor`, and synthetic `promptAsync` behavior plus `this` binding preservation in plugin hooks/autoloop.
- The smallest safe slice is one shared OpenCode client compatibility helper used by `index-core` and `control-tools` only.

## Wave 3 Implemented

- Added `src/orchestration/opencode-client-compat.ts` with shared `callSessionPromptAsync`, `callConfigProviders`, and `hasSessionPromptAsync` helpers.
- Switched `src/index-core.ts` autoloop prompt injection to the shared compat helper while preserving envelope-first fallback ordering.
- Switched `src/tools/control-tools.ts` provider lookup and slash workflow synthetic prompt injection to the shared compat helper.
- Preserved existing error strings for unavailable `promptAsync` and malformed `config.providers` responses.

## Refactor Wave 4

- `src/state/session-store.ts` still contained a large `applyEvent` switch with pure state transitions mixed into persistence/notification concerns.
- `test/session-store.test.ts` and plugin-driven event paths already covered the reducer semantics well enough to support a mechanical extraction.
- The smallest safe slice is a dedicated `src/state/session-event-reducer.ts` module that mutates `SessionState` in place via injected dependencies.

## Wave 4 Implemented

- Added `src/state/session-event-reducer.ts` with the full `applySessionEvent` transition logic and shared helpers for clearing failure/contradiction/loop-guard state.
- Switched `src/state/session-store.ts` so `applyEvent` now delegates to the reducer and keeps only event buffering, persistence, notification, and timestamp update responsibilities.
- Preserved `CONTRADICTION_PATCH_LOOP_BUDGET` behavior by exporting it from the reducer module and reusing it in existing `recordFailure`/`setFailureDetails` code.

## Refactor Wave 5

- `src/index-core.ts` still contained route counter snapshot state, text compaction, and `RouteDecision`/`StuckTrigger` JSONL formatting inline.
- Existing `plugin-hooks` tests already locked route decision output size bounds and stuck-trigger emission behavior.
- The smallest safe slice was a dedicated `src/orchestration/route-logging.ts` helper with injected config, sink append, and error handling.

## Wave 5 Implemented

- Added `src/orchestration/route-logging.ts` with shared route counter snapshot tracking and `RouteDecision`/`StuckTrigger` record formatting.
- Switched `src/index-core.ts` to use `createRouteLogger(...)` and removed the inline route logging state/formatting implementation.
- Preserved output file, bounded field sizes, stuck thresholds, and JSONL record shapes.

## Refactor Wave 6

- `src/index-core.ts` still contained the full autoloop runner, including stop conditions, prompt payload construction, search-mode prompt injection, note emission, and prompt dispatch fallback behavior.
- Existing tests in `test/plugin-hooks.test.ts` and `test/checklist-verification.test.ts` already locked autoloop enablement, idle-trigger dispatch, fallback payload behavior, and stop conditions.
- The smallest safe slice was a dedicated `src/orchestration/auto-loop.ts` helper with injected store, notes, toast, route, and work-package dependencies.

## Wave 6 Implemented

- Added `src/orchestration/auto-loop.ts` with shared autoloop runner creation and internal prompt dispatch helper.
- Switched `src/index-core.ts` to use `createAutoLoopRunner(...)` and removed the inline autoloop execution body.
- Preserved prompt fallback order, idle-trigger behavior, autoloop stop messages, and search-mode prompt guidance semantics.

## Refactor Wave 7

- `src/index-core.ts` still contained startup toast session tracking, scheduling, fallback-on-idle, and event announcement logic inline.
- `test/plugin-hooks.test.ts` already covered startup toast emission, duplicate suppression, child-session suppression, idle fallback, and startup-toasts-disabled behavior.
- The smallest safe slice was a dedicated `src/orchestration/startup-toast.ts` helper with injected toast emitter and top-level-session callback.

## Wave 7 Implemented

- Added `src/orchestration/startup-toast.ts` with startup toast tracking, scheduling, fallback, and event handling logic.
- Switched `src/index-core.ts` to use `createStartupToastManager(...)` while keeping terminal banner output in `index-core`.
- Preserved created-session, child-session, idle-fallback, and one-shot behavior; fixed fallback semantics so missing `showToast` does not permanently mark a session as already shown.
