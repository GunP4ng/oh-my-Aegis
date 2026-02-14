# decisions

- Parallelization is opt-in via config (no behavior change by default).
- Plugin provides parallel suggestions + playbook guidance; it cannot itself spawn multiple tool calls.
- Stuck detection threshold is configurable; default remains the current behavior (2 loops).
- Config keys + defaults: parallel_guidance.enabled=false, parallel_guidance.max_suggestions=3, stuck_threshold=2.
