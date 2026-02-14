import { z } from "zod";
export declare const DEFAULT_ROUTING: {
    readonly ctf: {
        readonly scan: {
            readonly WEB_API: "ctf-web";
            readonly WEB3: "ctf-web3";
            readonly PWN: "ctf-pwn";
            readonly REV: "ctf-rev";
            readonly CRYPTO: "ctf-crypto";
            readonly FORENSICS: "ctf-forensics";
            readonly MISC: "ctf-explore";
            readonly UNKNOWN: "ctf-explore";
        };
        readonly plan: {
            readonly WEB_API: "ctf-hypothesis";
            readonly WEB3: "ctf-hypothesis";
            readonly PWN: "ctf-hypothesis";
            readonly REV: "ctf-hypothesis";
            readonly CRYPTO: "ctf-hypothesis";
            readonly FORENSICS: "ctf-hypothesis";
            readonly MISC: "ctf-hypothesis";
            readonly UNKNOWN: "ctf-hypothesis";
        };
        readonly execute: {
            readonly WEB_API: "ctf-web";
            readonly WEB3: "ctf-web3";
            readonly PWN: "ctf-pwn";
            readonly REV: "ctf-rev";
            readonly CRYPTO: "ctf-crypto";
            readonly FORENSICS: "ctf-forensics";
            readonly MISC: "ctf-solve";
            readonly UNKNOWN: "ctf-solve";
        };
        readonly stuck: {
            readonly WEB_API: "ctf-research";
            readonly WEB3: "ctf-research";
            readonly PWN: "ctf-pwn";
            readonly REV: "ctf-rev";
            readonly CRYPTO: "ctf-crypto";
            readonly FORENSICS: "ctf-forensics";
            readonly MISC: "ctf-hypothesis";
            readonly UNKNOWN: "ctf-hypothesis";
        };
        readonly failover: {
            readonly WEB_API: "ctf-research";
            readonly WEB3: "ctf-research";
            readonly PWN: "ctf-pwn";
            readonly REV: "ctf-rev";
            readonly CRYPTO: "ctf-crypto";
            readonly FORENSICS: "ctf-forensics";
            readonly MISC: "ctf-hypothesis";
            readonly UNKNOWN: "ctf-hypothesis";
        };
    };
    readonly bounty: {
        readonly scan: {
            readonly WEB_API: "bounty-triage";
            readonly WEB3: "bounty-triage";
            readonly PWN: "bounty-triage";
            readonly REV: "bounty-triage";
            readonly CRYPTO: "bounty-triage";
            readonly FORENSICS: "bounty-triage";
            readonly MISC: "bounty-triage";
            readonly UNKNOWN: "bounty-triage";
        };
        readonly plan: {
            readonly WEB_API: "deep-plan";
            readonly WEB3: "deep-plan";
            readonly PWN: "deep-plan";
            readonly REV: "deep-plan";
            readonly CRYPTO: "deep-plan";
            readonly FORENSICS: "deep-plan";
            readonly MISC: "deep-plan";
            readonly UNKNOWN: "deep-plan";
        };
        readonly execute: {
            readonly WEB_API: "bounty-triage";
            readonly WEB3: "bounty-triage";
            readonly PWN: "bounty-triage";
            readonly REV: "bounty-triage";
            readonly CRYPTO: "bounty-triage";
            readonly FORENSICS: "bounty-triage";
            readonly MISC: "bounty-triage";
            readonly UNKNOWN: "bounty-triage";
        };
        readonly stuck: {
            readonly WEB_API: "bounty-research";
            readonly WEB3: "bounty-research";
            readonly PWN: "bounty-research";
            readonly REV: "bounty-research";
            readonly CRYPTO: "bounty-research";
            readonly FORENSICS: "bounty-research";
            readonly MISC: "bounty-research";
            readonly UNKNOWN: "bounty-research";
        };
        readonly failover: {
            readonly WEB_API: "bounty-research";
            readonly WEB3: "bounty-research";
            readonly PWN: "bounty-research";
            readonly REV: "bounty-research";
            readonly CRYPTO: "bounty-research";
            readonly FORENSICS: "bounty-research";
            readonly MISC: "bounty-research";
            readonly UNKNOWN: "bounty-research";
        };
    };
};
export declare const DEFAULT_CAPABILITY_PROFILES: {
    ctf: {
        WEB_API: {
            required_subagents: string[];
        };
        WEB3: {
            required_subagents: string[];
        };
        PWN: {
            required_subagents: string[];
        };
        REV: {
            required_subagents: string[];
        };
        CRYPTO: {
            required_subagents: string[];
        };
        FORENSICS: {
            required_subagents: string[];
        };
        MISC: {
            required_subagents: string[];
        };
        UNKNOWN: {
            required_subagents: string[];
        };
    };
    bounty: {
        WEB_API: {
            required_subagents: string[];
        };
        WEB3: {
            required_subagents: string[];
        };
        PWN: {
            required_subagents: string[];
        };
        REV: {
            required_subagents: string[];
        };
        CRYPTO: {
            required_subagents: string[];
        };
        FORENSICS: {
            required_subagents: string[];
        };
        MISC: {
            required_subagents: string[];
        };
        UNKNOWN: {
            required_subagents: string[];
        };
    };
};
declare const TargetRouteMapSchema: z.ZodObject<{
    WEB_API: z.ZodString;
    WEB3: z.ZodString;
    PWN: z.ZodString;
    REV: z.ZodString;
    CRYPTO: z.ZodString;
    FORENSICS: z.ZodString;
    MISC: z.ZodString;
    UNKNOWN: z.ZodString;
}, z.core.$strip>;
declare const RoutingSchema: z.ZodObject<{
    ctf: z.ZodDefault<z.ZodObject<{
        scan: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        plan: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        execute: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        stuck: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        failover: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    bounty: z.ZodDefault<z.ZodObject<{
        scan: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        plan: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        execute: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        stuck: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
        failover: z.ZodObject<{
            WEB_API: z.ZodString;
            WEB3: z.ZodString;
            PWN: z.ZodString;
            REV: z.ZodString;
            CRYPTO: z.ZodString;
            FORENSICS: z.ZodString;
            MISC: z.ZodString;
            UNKNOWN: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
declare const CapabilityProfilesSchema: z.ZodObject<{
    ctf: z.ZodDefault<z.ZodObject<{
        WEB_API: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        WEB3: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        PWN: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        REV: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        CRYPTO: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        FORENSICS: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        MISC: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        UNKNOWN: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
    bounty: z.ZodDefault<z.ZodObject<{
        WEB_API: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        WEB3: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        PWN: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        REV: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        CRYPTO: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        FORENSICS: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        MISC: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        UNKNOWN: z.ZodObject<{
            required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const OrchestratorConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    enable_builtin_mcps: z.ZodDefault<z.ZodBoolean>;
    disabled_mcps: z.ZodDefault<z.ZodArray<z.ZodString>>;
    strict_readiness: z.ZodDefault<z.ZodBoolean>;
    enable_injection_logging: z.ZodDefault<z.ZodBoolean>;
    enforce_todo_single_in_progress: z.ZodDefault<z.ZodBoolean>;
    tool_output_truncator: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        max_chars: z.ZodDefault<z.ZodNumber>;
        head_chars: z.ZodDefault<z.ZodNumber>;
        tail_chars: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    context_injection: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        inject_agents_md: z.ZodDefault<z.ZodBoolean>;
        inject_readme_md: z.ZodDefault<z.ZodBoolean>;
        max_files: z.ZodDefault<z.ZodNumber>;
        max_chars_per_file: z.ZodDefault<z.ZodNumber>;
        max_total_chars: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    target_detection: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        lock_after_first: z.ZodDefault<z.ZodBoolean>;
        only_in_scan: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    notes: z.ZodDefault<z.ZodObject<{
        root_dir: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    ctf_fast_verify: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        risky_targets: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            WEB_API: "WEB_API";
            WEB3: "WEB3";
            PWN: "PWN";
            REV: "REV";
            CRYPTO: "CRYPTO";
            FORENSICS: "FORENSICS";
            MISC: "MISC";
            UNKNOWN: "UNKNOWN";
        }>>>;
        require_nonempty_candidate: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    default_mode: z.ZodDefault<z.ZodEnum<{
        CTF: "CTF";
        BOUNTY: "BOUNTY";
    }>>;
    enforce_mode_header: z.ZodDefault<z.ZodBoolean>;
    allow_free_text_signals: z.ZodDefault<z.ZodBoolean>;
    stuck_threshold: z.ZodDefault<z.ZodNumber>;
    guardrails: z.ZodDefault<z.ZodObject<{
        deny_destructive_bash: z.ZodDefault<z.ZodBoolean>;
        destructive_command_patterns: z.ZodDefault<z.ZodArray<z.ZodString>>;
        bounty_scope_readonly_patterns: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    bounty_policy: z.ZodDefault<z.ZodObject<{
        scope_doc_candidates: z.ZodDefault<z.ZodArray<z.ZodString>>;
        require_scope_doc: z.ZodDefault<z.ZodBoolean>;
        enforce_allowed_hosts: z.ZodDefault<z.ZodBoolean>;
        enforce_blackout_windows: z.ZodDefault<z.ZodBoolean>;
        deny_scanner_commands: z.ZodDefault<z.ZodBoolean>;
        scanner_command_patterns: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    verification: z.ZodDefault<z.ZodObject<{
        verifier_tool_names: z.ZodDefault<z.ZodArray<z.ZodString>>;
        verifier_title_markers: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    markdown_budget: z.ZodDefault<z.ZodObject<{
        worklog_lines: z.ZodDefault<z.ZodNumber>;
        worklog_bytes: z.ZodDefault<z.ZodNumber>;
        evidence_lines: z.ZodDefault<z.ZodNumber>;
        evidence_bytes: z.ZodDefault<z.ZodNumber>;
        scan_lines: z.ZodDefault<z.ZodNumber>;
        scan_bytes: z.ZodDefault<z.ZodNumber>;
        context_pack_lines: z.ZodDefault<z.ZodNumber>;
        context_pack_bytes: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    failover: z.ZodDefault<z.ZodObject<{
        signatures: z.ZodDefault<z.ZodArray<z.ZodString>>;
        map: z.ZodDefault<z.ZodObject<{
            explore: z.ZodDefault<z.ZodString>;
            librarian: z.ZodDefault<z.ZodString>;
            oracle: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    dynamic_model: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        health_cooldown_ms: z.ZodDefault<z.ZodNumber>;
        generate_variants: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    auto_dispatch: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        preserve_user_category: z.ZodDefault<z.ZodBoolean>;
        max_failover_retries: z.ZodDefault<z.ZodNumber>;
        operational_feedback_enabled: z.ZodDefault<z.ZodBoolean>;
        operational_feedback_consecutive_failures: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    routing: z.ZodDefault<z.ZodObject<{
        ctf: z.ZodDefault<z.ZodObject<{
            scan: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            plan: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            execute: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            stuck: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            failover: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        bounty: z.ZodDefault<z.ZodObject<{
            scan: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            plan: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            execute: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            stuck: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
            failover: z.ZodObject<{
                WEB_API: z.ZodString;
                WEB3: z.ZodString;
                PWN: z.ZodString;
                REV: z.ZodString;
                CRYPTO: z.ZodString;
                FORENSICS: z.ZodString;
                MISC: z.ZodString;
                UNKNOWN: z.ZodString;
            }, z.core.$strip>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    capability_profiles: z.ZodDefault<z.ZodObject<{
        ctf: z.ZodDefault<z.ZodObject<{
            WEB_API: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            WEB3: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            PWN: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            REV: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            CRYPTO: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            FORENSICS: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            MISC: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            UNKNOWN: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        bounty: z.ZodDefault<z.ZodObject<{
            WEB_API: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            WEB3: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            PWN: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            REV: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            CRYPTO: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            FORENSICS: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            MISC: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            UNKNOWN: z.ZodObject<{
                required_subagents: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RouteTargetMap = z.infer<typeof TargetRouteMapSchema>;
export type RoutingConfig = z.infer<typeof RoutingSchema>;
export type CapabilityProfiles = z.infer<typeof CapabilityProfilesSchema>;
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
export {};
