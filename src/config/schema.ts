import { z } from "zod";
import { AnyMcpNameSchema } from "../mcp/types";

export const DEFAULT_ROUTING = {
  ctf: {
    scan: {
      WEB_API: "ctf-web",
      WEB3: "ctf-web3",
      PWN: "ctf-pwn",
      REV: "ctf-rev",
      CRYPTO: "ctf-crypto",
      FORENSICS: "ctf-forensics",
      MISC: "ctf-explore",
      UNKNOWN: "ctf-explore",
    },
    plan: {
      WEB_API: "aegis-plan",
      WEB3: "aegis-plan",
      PWN: "aegis-plan",
      REV: "aegis-plan",
      CRYPTO: "aegis-plan",
      FORENSICS: "aegis-plan",
      MISC: "aegis-plan",
      UNKNOWN: "aegis-plan",
    },
    execute: {
      WEB_API: "aegis-exec",
      WEB3: "aegis-exec",
      PWN: "aegis-exec",
      REV: "aegis-exec",
      CRYPTO: "aegis-exec",
      FORENSICS: "aegis-exec",
      MISC: "aegis-exec",
      UNKNOWN: "aegis-exec",
    },
    stuck: {
      WEB_API: "ctf-research",
      WEB3: "ctf-research",
      PWN: "aegis-deep",
      REV: "aegis-deep",
      CRYPTO: "ctf-crypto",
      FORENSICS: "ctf-forensics",
      MISC: "ctf-hypothesis",
      UNKNOWN: "ctf-hypothesis",
    },
    failover: {
      WEB_API: "ctf-research",
      WEB3: "ctf-research",
      PWN: "ctf-pwn",
      REV: "ctf-rev",
      CRYPTO: "ctf-crypto",
      FORENSICS: "ctf-forensics",
      MISC: "ctf-hypothesis",
      UNKNOWN: "ctf-hypothesis",
    },
  },
  bounty: {
    scan: {
      WEB_API: "bounty-triage",
      WEB3: "bounty-triage",
      PWN: "bounty-triage",
      REV: "bounty-triage",
      CRYPTO: "bounty-triage",
      FORENSICS: "bounty-triage",
      MISC: "bounty-triage",
      UNKNOWN: "bounty-triage",
    },
    plan: {
      WEB_API: "aegis-plan",
      WEB3: "aegis-plan",
      PWN: "aegis-plan",
      REV: "aegis-plan",
      CRYPTO: "aegis-plan",
      FORENSICS: "aegis-plan",
      MISC: "aegis-plan",
      UNKNOWN: "aegis-plan",
    },
    execute: {
      WEB_API: "aegis-exec",
      WEB3: "aegis-exec",
      PWN: "aegis-exec",
      REV: "aegis-exec",
      CRYPTO: "aegis-exec",
      FORENSICS: "aegis-exec",
      MISC: "aegis-exec",
      UNKNOWN: "aegis-exec",
    },
    stuck: {
      WEB_API: "bounty-research",
      WEB3: "bounty-research",
      PWN: "bounty-triage",
      REV: "bounty-triage",
      CRYPTO: "bounty-research",
      FORENSICS: "bounty-triage",
      MISC: "bounty-research",
      UNKNOWN: "bounty-research",
    },
    failover: {
      WEB_API: "bounty-research",
      WEB3: "bounty-research",
      PWN: "bounty-scope",
      REV: "bounty-scope",
      CRYPTO: "bounty-research",
      FORENSICS: "bounty-scope",
      MISC: "bounty-research",
      UNKNOWN: "bounty-research",
    },
  },
} as const;

export const DEFAULT_CAPABILITY_PROFILES = {
  ctf: {
    WEB_API: { required_subagents: ["ctf-web", "ctf-research", "ctf-verify"] },
    WEB3: { required_subagents: ["ctf-web3", "ctf-research", "ctf-verify"] },
    PWN: { required_subagents: ["ctf-pwn", "ctf-solve"] },
    REV: { required_subagents: ["ctf-rev", "ctf-solve"] },
    CRYPTO: { required_subagents: ["ctf-crypto", "ctf-solve"] },
    FORENSICS: { required_subagents: ["ctf-forensics", "ctf-solve"] },
    MISC: { required_subagents: ["ctf-explore", "ctf-solve"] },
    UNKNOWN: { required_subagents: ["ctf-explore", "ctf-solve"] },
  },
  bounty: {
    WEB_API: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
    WEB3: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
    PWN: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
    REV: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
    CRYPTO: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
    FORENSICS: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
    MISC: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
    UNKNOWN: { required_subagents: ["bounty-scope", "bounty-triage", "bounty-research"] },
  },
};

export const DEFAULT_SKILL_AUTOLOAD = {
  enabled: true,
  max_skills: 2,
  ctf: {
    scan: {
      WEB_API: ["top-web-vulnerabilities"],
      WEB3: ["ctf-solver"],
      PWN: ["ctf-solver"],
      REV: ["ctf-solver"],
      CRYPTO: ["ctf-solver"],
      FORENSICS: ["ctf-solver"],
      MISC: ["ctf-solver"],
      UNKNOWN: ["ctf-solver"],
    },
    plan: {
      WEB_API: ["plan-writing"],
      WEB3: ["plan-writing"],
      PWN: ["plan-writing"],
      REV: ["plan-writing"],
      CRYPTO: ["plan-writing"],
      FORENSICS: ["plan-writing"],
      MISC: ["plan-writing"],
      UNKNOWN: ["plan-writing"],
    },
    execute: {
      WEB_API: ["idor-testing", "systematic-debugging"],
      WEB3: ["systematic-debugging"],
      PWN: ["systematic-debugging"],
      REV: ["systematic-debugging"],
      CRYPTO: ["systematic-debugging"],
      FORENSICS: ["systematic-debugging"],
      MISC: ["systematic-debugging"],
      UNKNOWN: ["systematic-debugging"],
    },
  },
  bounty: {
    scan: {
      WEB_API: ["top-web-vulnerabilities"],
      WEB3: ["ethical-hacking-methodology"],
      PWN: ["ethical-hacking-methodology"],
      REV: ["ethical-hacking-methodology"],
      CRYPTO: ["ethical-hacking-methodology"],
      FORENSICS: ["ethical-hacking-methodology"],
      MISC: ["ethical-hacking-methodology"],
      UNKNOWN: ["ethical-hacking-methodology"],
    },
    plan: {
      WEB_API: ["plan-writing"],
      WEB3: ["plan-writing"],
      PWN: ["plan-writing"],
      REV: ["plan-writing"],
      CRYPTO: ["plan-writing"],
      FORENSICS: ["plan-writing"],
      MISC: ["plan-writing"],
      UNKNOWN: ["plan-writing"],
    },
    execute: {
      WEB_API: ["vulnerability-scanner"],
      WEB3: ["vulnerability-scanner"],
      PWN: ["vulnerability-scanner"],
      REV: ["vulnerability-scanner"],
      CRYPTO: ["vulnerability-scanner"],
      FORENSICS: ["vulnerability-scanner"],
      MISC: ["vulnerability-scanner"],
      UNKNOWN: ["vulnerability-scanner"],
    },
  },
  by_subagent: {
    "aegis-plan": ["ctf-workflow"],
    "aegis-exec": ["ctf-workflow"],
    "bounty-scope": ["bounty-workflow"],
    "ctf-rev": ["rev-analysis"],
    "ctf-pwn": ["pwn-exploit"],
  },
};

const GuardrailsSchema = z.object({
  deny_destructive_bash: z.boolean().default(true),
  destructive_command_patterns: z.array(z.string()).default([
    "\\brm\\s+-rf\\b",
    "\\bmkfs\\b",
    "\\bdd\\s+if=",
    "\\bshutdown\\b",
    "\\breboot\\b",
    "\\bpoweroff\\b",
    "\\bchown\\s+-R\\b",
    "\\bchmod\\s+777\\b",
    "\\bgit\\s+reset\\s+--hard\\b",
    "\\bgit\\s+clean\\s+-fdx\\b",
  ]),
  bounty_scope_readonly_patterns: z.array(z.string()).default([
    "^ls(\\s|$)",
    "^pwd(\\s|$)",
    "^whoami(\\s|$)",
    "^id(\\s|$)",
    "^uname(\\s|$)",
    "^cat(\\s|$)",
    "^head(\\s|$)",
    "^tail(\\s|$)",
    "^grep(\\s|$)",
    "^rg(\\s|$)",
    "^find(\\s|$)",
    "^readelf(\\s|$)",
    "^objdump(\\s|$)",
    "^strings(\\s|$)",
    "^xxd(\\s|$)",
    "^hexdump(\\s|$)",
    "^file(\\s|$)",
    "^sha256sum(\\s|$)",
  ]),
});

const VerificationSchema = z.object({
  verifier_tool_names: z.array(z.string()).default(["task", "bash", "pwno_run_command", "pwno_pwncli"]),
  verifier_title_markers: z.array(z.string()).default([
    "ctf-verify",
    "checker",
    "validator",
    "submission",
    "judge",
    "scoreboard",
  ]),
});

const SkillListSchema = z.array(z.string()).default([]);

const TargetSkillMapSchema = z.object({
  WEB_API: SkillListSchema,
  WEB3: SkillListSchema,
  PWN: SkillListSchema,
  REV: SkillListSchema,
  CRYPTO: SkillListSchema,
  FORENSICS: SkillListSchema,
  MISC: SkillListSchema,
  UNKNOWN: SkillListSchema,
});

const SkillAutoloadModeSchema = z.object({
  scan: TargetSkillMapSchema,
  plan: TargetSkillMapSchema,
  execute: TargetSkillMapSchema,
});

const SkillAutoloadSchema = z
  .object({
    enabled: z.boolean().default(true),
    max_skills: z.number().int().positive().default(2),
    ctf: SkillAutoloadModeSchema.default(DEFAULT_SKILL_AUTOLOAD.ctf),
    bounty: SkillAutoloadModeSchema.default(DEFAULT_SKILL_AUTOLOAD.bounty),
    by_subagent: z.record(z.string(), z.array(z.string())).default({}),
  })
  .default(DEFAULT_SKILL_AUTOLOAD);

const MarkdownBudgetSchema = z.object({
  worklog_lines: z.number().int().positive().default(300),
  worklog_bytes: z.number().int().positive().default(24 * 1024),
  evidence_lines: z.number().int().positive().default(250),
  evidence_bytes: z.number().int().positive().default(20 * 1024),
  scan_lines: z.number().int().positive().default(200),
  scan_bytes: z.number().int().positive().default(16 * 1024),
  context_pack_lines: z.number().int().positive().default(80),
  context_pack_bytes: z.number().int().positive().default(8 * 1024),
});

const FailoverSchema = z.object({
  signatures: z.array(z.string()).default([
    "context_length_exceeded",
    "invalid_request_error",
    "timeout",
    "timed out",
    "etimedout",
  ]),
  map: z
    .object({
      explore: z.string().default("explore-fallback"),
      librarian: z.string().default("librarian-fallback"),
      oracle: z.string().default("oracle-fallback"),
    })
    .default({
      explore: "explore-fallback",
      librarian: "librarian-fallback",
      oracle: "oracle-fallback",
    }),
});

const DynamicModelSchema = z.object({
  enabled: z.boolean().default(false),
  health_cooldown_ms: z.number().int().positive().default(300_000),
  generate_variants: z.boolean().default(true),
});

const BountyPolicySchema = z.object({
  scope_doc_candidates: z.array(z.string()).default([
    ".Aegis/scope.md",
    ".opencode/bounty-scope.md",
    "BOUNTY_SCOPE.md",
    "SCOPE.md",
  ]),
  require_scope_doc: z.boolean().default(false),
  enforce_allowed_hosts: z.boolean().default(true),
  include_apex_for_wildcard_allow: z.boolean().default(false),
  enforce_blackout_windows: z.boolean().default(true),
  deny_scanner_commands: z.boolean().default(true),
  scanner_command_patterns: z.array(z.string()).default([
    "\\bnmap\\b",
    "\\bmasscan\\b",
    "\\bnuclei\\b",
    "\\bffuf\\b",
    "\\bferoxbuster\\b",
    "\\bgobuster\\b",
    "\\bdirb\\b",
    "\\bwfuzz\\b",
    "\\bnikto\\b",
    "\\bsqlmap\\b",
    "\\bhydra\\b",
    "\\bpatator\\b",
    "\\bjohn\\b",
  ]),
});

const AutoDispatchSchema = z.object({
  enabled: z.boolean().default(true),
  preserve_user_category: z.boolean().default(true),
  max_failover_retries: z.number().int().positive().default(2),
  operational_feedback_enabled: z.boolean().default(false),
  operational_feedback_consecutive_failures: z.number().int().positive().default(2),
});

const ToolOutputTruncatorSchema = z
  .object({
    enabled: z.boolean().default(true),
    persist_mask_sensitive: z.boolean().default(false),
    max_chars: z.number().int().positive().default(30_000),
    head_chars: z.number().int().positive().default(12_000),
    tail_chars: z.number().int().positive().default(4_000),
    per_tool_max_chars: z.record(z.string(), z.number().int().positive()).default({}),
  })
  .default({
    enabled: true,
    persist_mask_sensitive: false,
    max_chars: 30_000,
    head_chars: 12_000,
    tail_chars: 4_000,
    per_tool_max_chars: {
      bash: 20_000,
      grep: 20_000,
      task: 30_000,
    },
  });

const ContextInjectionSchema = z
  .object({
    enabled: z.boolean().default(true),
    inject_agents_md: z.boolean().default(true),
    inject_readme_md: z.boolean().default(true),
    max_files: z.number().int().positive().default(6),
    max_chars_per_file: z.number().int().positive().default(4_000),
    max_total_chars: z.number().int().positive().default(16_000),
  })
  .default({
    enabled: true,
    inject_agents_md: true,
    inject_readme_md: true,
    max_files: 6,
    max_chars_per_file: 4_000,
    max_total_chars: 16_000,
  });

const AutoLoopSchema = z
  .object({
    enabled: z.boolean().default(true),
    only_when_ultrawork: z.boolean().default(true),
    idle_delay_ms: z.number().int().nonnegative().default(350),
    max_iterations: z.number().int().positive().default(200),
    stop_on_verified: z.boolean().default(true),
  })
  .default({
    enabled: true,
    only_when_ultrawork: true,
    idle_delay_ms: 350,
    max_iterations: 200,
    stop_on_verified: true,
  });

const TargetDetectionSchema = z
  .object({
    enabled: z.boolean().default(true),
    lock_after_first: z.boolean().default(true),
    only_in_scan: z.boolean().default(true),
  })
  .default({
    enabled: true,
    lock_after_first: true,
    only_in_scan: true,
  });

const NotesSchema = z
  .object({
    root_dir: z.string().min(1).default(".Aegis"),
  })
  .default({
    root_dir: ".Aegis",
  });

const CommentCheckerSchema = z
  .object({
    enabled: z.boolean().default(true),
    only_in_bounty: z.boolean().default(true),
    min_added_lines: z.number().int().nonnegative().default(12),
    max_comment_ratio: z.number().min(0).max(1).default(0.35),
    max_comment_lines: z.number().int().nonnegative().default(25),
  })
  .default({
    enabled: true,
    only_in_bounty: true,
    min_added_lines: 12,
    max_comment_ratio: 0.35,
    max_comment_lines: 25,
  });

const RulesInjectorSchema = z
  .object({
    enabled: z.boolean().default(true),
    max_files: z.number().int().positive().default(6),
    max_chars_per_file: z.number().int().positive().default(3_000),
    max_total_chars: z.number().int().positive().default(12_000),
  })
  .default({
    enabled: true,
    max_files: 6,
    max_chars_per_file: 3_000,
    max_total_chars: 12_000,
  });

const RecoverySchema = z
  .object({
    enabled: z.boolean().default(true),
    empty_message_sanitizer: z.boolean().default(true),
    auto_compact_on_context_failure: z.boolean().default(true),
    context_window_proactive_compaction: z.boolean().default(true),
    context_window_proactive_threshold_ratio: z.number().min(0.5).max(0.99).default(0.9),
    context_window_proactive_rearm_ratio: z.number().min(0.3).max(0.95).default(0.75),
    edit_error_hint: z.boolean().default(true),
    thinking_block_validator: z.boolean().default(true),
    non_interactive_env: z.boolean().default(true),
    session_recovery: z.boolean().default(true),
    context_window_recovery: z.boolean().default(true),
    context_window_recovery_cooldown_ms: z.number().int().nonnegative().default(15_000),
    context_window_recovery_max_attempts_per_session: z.number().int().positive().default(6),
  })
  .default({
    enabled: true,
    empty_message_sanitizer: true,
    auto_compact_on_context_failure: true,
    context_window_proactive_compaction: true,
    context_window_proactive_threshold_ratio: 0.9,
    context_window_proactive_rearm_ratio: 0.75,
    edit_error_hint: true,
    thinking_block_validator: true,
    non_interactive_env: true,
    session_recovery: true,
    context_window_recovery: true,
    context_window_recovery_cooldown_ms: 15_000,
    context_window_recovery_max_attempts_per_session: 6,
  });

const InteractiveSchema = z
  .object({
    enabled: z.boolean().default(false),
    enabled_in_ctf: z.boolean().default(true),
  })
  .default({
    enabled: false,
    enabled_in_ctf: true,
  });

const ParallelBountyScanSchema = z
  .object({
    max_tracks: z.number().int().min(1).max(5).default(3),
    triage_tracks: z.number().int().min(0).max(5).default(2),
    research_tracks: z.number().int().min(0).max(5).default(1),
    scope_recheck_tracks: z.number().int().min(0).max(5).default(0),
  })
  .default({
    max_tracks: 3,
    triage_tracks: 2,
    research_tracks: 1,
    scope_recheck_tracks: 0,
  });

const ParallelSchema = z
  .object({
    queue_enabled: z.boolean().default(true),
    max_concurrent_per_provider: z.number().int().positive().default(2),
    provider_caps: z.record(z.string(), z.number().int().positive()).default({}),
    auto_dispatch_scan: z.boolean().default(false),
    auto_dispatch_hypothesis: z.boolean().default(false),
    bounty_scan: ParallelBountyScanSchema,
  })
  .default({
    queue_enabled: true,
    max_concurrent_per_provider: 2,
    provider_caps: {},
    auto_dispatch_scan: false,
    auto_dispatch_hypothesis: false,
    bounty_scan: {
      max_tracks: 3,
      triage_tracks: 2,
      research_tracks: 1,
      scope_recheck_tracks: 0,
    },
  });

const MemorySchema = z
  .object({
    enabled: z.boolean().default(true),
    storage_dir: z.string().min(1).default(".Aegis/memory"),
  })
  .default({
    enabled: true,
    storage_dir: ".Aegis/memory",
  });

const SequentialThinkingSchema = z
  .object({
    enabled: z.boolean().default(true),
    activate_phases: z.array(z.enum(["SCAN", "PLAN", "EXECUTE", "VERIFY", "SUBMIT"])).default(["PLAN", "VERIFY"]),
    activate_targets: z.array(z.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"])).default([
      "REV",
      "CRYPTO",
    ]),
    activate_on_stuck: z.boolean().default(true),
    disable_with_thinking_model: z.boolean().default(true),
    tool_name: z.string().min(1).default("aegis_think"),
  })
  .default({
    enabled: true,
    activate_phases: ["PLAN", "VERIFY"],
    activate_targets: ["REV", "CRYPTO"],
    activate_on_stuck: true,
    disable_with_thinking_model: true,
    tool_name: "aegis_think",
  });

const TuiNotificationsSchema = z
  .object({
    enabled: z.boolean().default(false),
    throttle_ms: z.number().int().nonnegative().default(5_000),
    startup_toast: z.boolean().default(true),
    startup_terminal_banner: z.boolean().default(true),
  })
  .default({
    enabled: false,
    throttle_ms: 5_000,
    startup_toast: true,
    startup_terminal_banner: true,
  });

const TargetRouteMapSchema = z.object({
  WEB_API: z.string().min(1),
  WEB3: z.string().min(1),
  PWN: z.string().min(1),
  REV: z.string().min(1),
  CRYPTO: z.string().min(1),
  FORENSICS: z.string().min(1),
  MISC: z.string().min(1),
  UNKNOWN: z.string().min(1),
});

const DomainRoutingSchema = z.object({
  scan: TargetRouteMapSchema,
  plan: TargetRouteMapSchema,
  execute: TargetRouteMapSchema,
  stuck: TargetRouteMapSchema,
  failover: TargetRouteMapSchema,
});

const RoutingSchema = z.object({
  ctf: DomainRoutingSchema.default(DEFAULT_ROUTING.ctf),
  bounty: DomainRoutingSchema.default(DEFAULT_ROUTING.bounty),
});

const CapabilityProfileSchema = z.object({
  required_subagents: z.array(z.string()).default([]),
});

const TargetCapabilitySchema = z.object({
  WEB_API: CapabilityProfileSchema,
  WEB3: CapabilityProfileSchema,
  PWN: CapabilityProfileSchema,
  REV: CapabilityProfileSchema,
  CRYPTO: CapabilityProfileSchema,
  FORENSICS: CapabilityProfileSchema,
  MISC: CapabilityProfileSchema,
  UNKNOWN: CapabilityProfileSchema,
});

const CapabilityProfilesSchema = z.object({
  ctf: TargetCapabilitySchema.default(DEFAULT_CAPABILITY_PROFILES.ctf),
  bounty: TargetCapabilitySchema.default(DEFAULT_CAPABILITY_PROFILES.bounty),
});

const AutoTriageSchema = z.object({
  enabled: z.boolean().default(true),
}).default({ enabled: true });

const FlagDetectorSchema = z.object({
  enabled: z.boolean().default(true),
  custom_patterns: z.array(z.string()).default([]),
}).default({ enabled: true, custom_patterns: [] });

const PatternMatcherSchema = z.object({
  enabled: z.boolean().default(true),
}).default({ enabled: true });

const ReconPipelineSchema = z.object({
  enabled: z.boolean().default(true),
  max_commands_per_phase: z.number().int().positive().default(10),
}).default({ enabled: true, max_commands_per_phase: 10 });

const DeltaScanSchema = z.object({
  enabled: z.boolean().default(true),
  max_age_ms: z.number().int().positive().default(24 * 60 * 60 * 1000),
}).default({ enabled: true, max_age_ms: 86400000 });

const ReportGeneratorSchema = z.object({
  enabled: z.boolean().default(true),
}).default({ enabled: true });

const AutoPhaseSchema = z.object({
  enabled: z.boolean().default(true),
  scan_to_plan_tool_count: z.number().int().positive().default(8),
  plan_to_execute_on_todo: z.boolean().default(true),
}).default({ enabled: true, scan_to_plan_tool_count: 8, plan_to_execute_on_todo: true });

const DebugSchema = z.object({
  log_all_hooks: z.boolean().default(false),
  log_tool_call_counts: z.boolean().default(true),
}).default({ log_all_hooks: false, log_tool_call_counts: true });

export const OrchestratorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  enable_builtin_mcps: z.boolean().default(true),
  google_auth: z.boolean().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).default([]),
  strict_readiness: z.boolean().default(true),
  enable_injection_logging: z.boolean().default(true),
  enforce_todo_single_in_progress: z.boolean().default(true),
  enforce_todo_flow_non_scan: z.boolean().default(true),
  enforce_todo_granularity_non_scan: z.boolean().default(true),
  todo_min_items_non_scan: z.number().int().min(1).default(2),
  parallel: ParallelSchema,
  tool_output_truncator: ToolOutputTruncatorSchema,
  context_injection: ContextInjectionSchema,
  auto_loop: AutoLoopSchema,
  target_detection: TargetDetectionSchema,
  notes: NotesSchema,
  comment_checker: CommentCheckerSchema,
  rules_injector: RulesInjectorSchema,
  recovery: RecoverySchema,
  interactive: InteractiveSchema,
  tui_notifications: TuiNotificationsSchema,
  memory: MemorySchema,
  sequential_thinking: SequentialThinkingSchema,
  ctf_fast_verify: z
    .object({
      enabled: z.boolean().default(true),
      enforce_all_targets: z.boolean().default(false),
      risky_targets: z.array(z.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"])).default([
        "PWN",
        "REV",
        "CRYPTO",
      ]),
      require_nonempty_candidate: z.boolean().default(true),
    })
    .default({
      enabled: true,
      enforce_all_targets: false,
      risky_targets: ["PWN", "REV", "CRYPTO"],
      require_nonempty_candidate: true,
    }),
  default_mode: z.enum(["CTF", "BOUNTY"]).default("BOUNTY"),
  enforce_mode_header: z.boolean().default(false),
  allow_free_text_signals: z.boolean().default(false),
  stuck_threshold: z.number().int().positive().default(2),
  guardrails: GuardrailsSchema.default(GuardrailsSchema.parse({})),
  bounty_policy: BountyPolicySchema.default(BountyPolicySchema.parse({})),
  verification: VerificationSchema.default(VerificationSchema.parse({})),
  markdown_budget: MarkdownBudgetSchema.default(MarkdownBudgetSchema.parse({})),
  failover: FailoverSchema.default(FailoverSchema.parse({})),
  dynamic_model: DynamicModelSchema.default(DynamicModelSchema.parse({})),
  auto_dispatch: AutoDispatchSchema.default(AutoDispatchSchema.parse({})),
  routing: RoutingSchema.default(DEFAULT_ROUTING),
  capability_profiles: CapabilityProfilesSchema.default(DEFAULT_CAPABILITY_PROFILES),
  skill_autoload: SkillAutoloadSchema,
  auto_triage: AutoTriageSchema,
  flag_detector: FlagDetectorSchema,
  pattern_matcher: PatternMatcherSchema,
  recon_pipeline: ReconPipelineSchema,
  delta_scan: DeltaScanSchema,
  report_generator: ReportGeneratorSchema,
  auto_phase: AutoPhaseSchema,
  debug: DebugSchema,
});

export type RouteTargetMap = z.infer<typeof TargetRouteMapSchema>;
export type RoutingConfig = z.infer<typeof RoutingSchema>;
export type CapabilityProfiles = z.infer<typeof CapabilityProfilesSchema>;

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
