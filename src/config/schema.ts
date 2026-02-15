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
      WEB_API: "ctf-hypothesis",
      WEB3: "ctf-hypothesis",
      PWN: "ctf-hypothesis",
      REV: "ctf-hypothesis",
      CRYPTO: "ctf-hypothesis",
      FORENSICS: "ctf-hypothesis",
      MISC: "ctf-hypothesis",
      UNKNOWN: "ctf-hypothesis",
    },
    execute: {
      WEB_API: "ctf-web",
      WEB3: "ctf-web3",
      PWN: "ctf-pwn",
      REV: "ctf-rev",
      CRYPTO: "ctf-crypto",
      FORENSICS: "ctf-forensics",
      MISC: "ctf-solve",
      UNKNOWN: "ctf-solve",
    },
    stuck: {
      WEB_API: "ctf-research",
      WEB3: "ctf-research",
      PWN: "ctf-pwn",
      REV: "ctf-rev",
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
      WEB_API: "deep-plan",
      WEB3: "deep-plan",
      PWN: "deep-plan",
      REV: "deep-plan",
      CRYPTO: "deep-plan",
      FORENSICS: "deep-plan",
      MISC: "deep-plan",
      UNKNOWN: "deep-plan",
    },
    execute: {
      WEB_API: "bounty-triage",
      WEB3: "bounty-triage",
      PWN: "bounty-triage",
      REV: "bounty-triage",
      CRYPTO: "bounty-triage",
      FORENSICS: "bounty-triage",
      MISC: "bounty-triage",
      UNKNOWN: "bounty-triage",
    },
    stuck: {
      WEB_API: "bounty-research",
      WEB3: "bounty-research",
      PWN: "bounty-research",
      REV: "bounty-research",
      CRYPTO: "bounty-research",
      FORENSICS: "bounty-research",
      MISC: "bounty-research",
      UNKNOWN: "bounty-research",
    },
    failover: {
      WEB_API: "bounty-research",
      WEB3: "bounty-research",
      PWN: "bounty-research",
      REV: "bounty-research",
      CRYPTO: "bounty-research",
      FORENSICS: "bounty-research",
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
    max_chars: z.number().int().positive().default(30_000),
    head_chars: z.number().int().positive().default(12_000),
    tail_chars: z.number().int().positive().default(4_000),
  })
  .default({
    enabled: true,
    max_chars: 30_000,
    head_chars: 12_000,
    tail_chars: 4_000,
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
    edit_error_hint: z.boolean().default(true),
  })
  .default({
    enabled: true,
    empty_message_sanitizer: true,
    auto_compact_on_context_failure: true,
    edit_error_hint: true,
  });

const InteractiveSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .default({
    enabled: false,
  });

const TuiNotificationsSchema = z
  .object({
    enabled: z.boolean().default(false),
    throttle_ms: z.number().int().nonnegative().default(5_000),
  })
  .default({
    enabled: false,
    throttle_ms: 5_000,
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

export const OrchestratorConfigSchema = z.object({
  enabled: z.boolean().default(true),
  enable_builtin_mcps: z.boolean().default(true),
  google_auth: z.boolean().optional(),
  disabled_mcps: z.array(AnyMcpNameSchema).default([]),
  strict_readiness: z.boolean().default(true),
  enable_injection_logging: z.boolean().default(true),
  enforce_todo_single_in_progress: z.boolean().default(true),
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
  ctf_fast_verify: z
    .object({
      enabled: z.boolean().default(true),
      risky_targets: z.array(z.enum(["WEB_API", "WEB3", "PWN", "REV", "CRYPTO", "FORENSICS", "MISC", "UNKNOWN"])).default([
        "WEB_API",
        "WEB3",
        "UNKNOWN",
      ]),
      require_nonempty_candidate: z.boolean().default(true),
    })
    .default({
      enabled: true,
      risky_targets: ["WEB_API", "WEB3", "UNKNOWN"],
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
});

export type RouteTargetMap = z.infer<typeof TargetRouteMapSchema>;
export type RoutingConfig = z.infer<typeof RoutingSchema>;
export type CapabilityProfiles = z.infer<typeof CapabilityProfilesSchema>;

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
