# oh-my-Aegis Standalone Orchestrator

`oh-my-Aegis` is positioned as a standalone CTF/BOUNTY orchestrator plugin for OpenCode.

## Product Boundary

- Primary domain: CTF and bug bounty orchestration.
- Runtime control: mode-gated execution (`MODE: CTF` / `MODE: BOUNTY`).
- Installation outcome:
  - plugin entry ensured in OpenCode config
  - auth plugins ensured (`opencode-antigravity-auth`, `opencode-openai-codex-auth`)
  - provider catalogs ensured (`provider.google`, `provider.openai`)
  - orchestrator config ensured (`oh-my-Aegis.json`)

## CLI Surface

- `oh-my-aegis install`: interactive/non-interactive bootstrap.
- `oh-my-aegis run`: wraps `opencode run` with mode-aware message bootstrap.
- `oh-my-aegis doctor`: local health diagnostics.
- `oh-my-aegis readiness`: readiness report (JSON).
- `oh-my-aegis get-local-version`: local/latest version and install entry check.

## Provider Strategy

- Antigravity model catalog uses variant-based keys:
  - `antigravity-gemini-3-pro` (`low`, `high`)
  - `antigravity-gemini-3-flash` (`minimal`, `low`, `medium`, `high`)
- Legacy keys (`antigravity-gemini-3-pro-high`, `antigravity-gemini-3-pro-low`) are migrated during install/apply.
- OpenAI catalog includes Codex-focused entries (`gpt-5.2-codex`) with reasoning variants.

## Version Pinning

- Installer resolves package plugin entry as `oh-my-aegis@<tag|version>` via npm dist-tags.
- Antigravity auth plugin is pinned to npm latest version; fallback is `@latest`.

## Test Coverage Focus

- install/apply config merge + migration behavior
- plugin hooks policy and recovery flows
- routing and failover behavior
- readiness matrix by mode/target
