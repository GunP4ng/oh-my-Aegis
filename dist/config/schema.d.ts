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
            readonly WEB_API: "aegis-plan";
            readonly WEB3: "aegis-plan";
            readonly PWN: "aegis-plan";
            readonly REV: "aegis-plan";
            readonly CRYPTO: "aegis-plan";
            readonly FORENSICS: "aegis-plan";
            readonly MISC: "aegis-plan";
            readonly UNKNOWN: "aegis-plan";
        };
        readonly execute: {
            readonly WEB_API: "aegis-exec";
            readonly WEB3: "aegis-exec";
            readonly PWN: "aegis-exec";
            readonly REV: "aegis-exec";
            readonly CRYPTO: "aegis-exec";
            readonly FORENSICS: "aegis-exec";
            readonly MISC: "aegis-exec";
            readonly UNKNOWN: "aegis-exec";
        };
        readonly stuck: {
            readonly WEB_API: "ctf-research";
            readonly WEB3: "ctf-research";
            readonly PWN: "aegis-deep";
            readonly REV: "aegis-deep";
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
            readonly WEB_API: "aegis-plan";
            readonly WEB3: "aegis-plan";
            readonly PWN: "aegis-plan";
            readonly REV: "aegis-plan";
            readonly CRYPTO: "aegis-plan";
            readonly FORENSICS: "aegis-plan";
            readonly MISC: "aegis-plan";
            readonly UNKNOWN: "aegis-plan";
        };
        readonly execute: {
            readonly WEB_API: "aegis-exec";
            readonly WEB3: "aegis-exec";
            readonly PWN: "aegis-exec";
            readonly REV: "aegis-exec";
            readonly CRYPTO: "aegis-exec";
            readonly FORENSICS: "aegis-exec";
            readonly MISC: "aegis-exec";
            readonly UNKNOWN: "aegis-exec";
        };
        readonly stuck: {
            readonly WEB_API: "bounty-research";
            readonly WEB3: "bounty-research";
            readonly PWN: "bounty-triage";
            readonly REV: "bounty-triage";
            readonly CRYPTO: "bounty-research";
            readonly FORENSICS: "bounty-triage";
            readonly MISC: "bounty-research";
            readonly UNKNOWN: "bounty-research";
        };
        readonly failover: {
            readonly WEB_API: "bounty-research";
            readonly WEB3: "bounty-research";
            readonly PWN: "bounty-scope";
            readonly REV: "bounty-scope";
            readonly CRYPTO: "bounty-research";
            readonly FORENSICS: "bounty-scope";
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
export declare const DEFAULT_SKILL_AUTOLOAD: {
    enabled: boolean;
    max_skills: number;
    ctf: {
        scan: {
            WEB_API: string[];
            WEB3: string[];
            PWN: string[];
            REV: string[];
            CRYPTO: string[];
            FORENSICS: string[];
            MISC: string[];
            UNKNOWN: string[];
        };
        plan: {
            WEB_API: string[];
            WEB3: string[];
            PWN: string[];
            REV: string[];
            CRYPTO: string[];
            FORENSICS: string[];
            MISC: string[];
            UNKNOWN: string[];
        };
        execute: {
            WEB_API: string[];
            WEB3: string[];
            PWN: string[];
            REV: string[];
            CRYPTO: string[];
            FORENSICS: string[];
            MISC: string[];
            UNKNOWN: string[];
        };
    };
    bounty: {
        scan: {
            WEB_API: string[];
            WEB3: string[];
            PWN: string[];
            REV: string[];
            CRYPTO: string[];
            FORENSICS: string[];
            MISC: string[];
            UNKNOWN: string[];
        };
        plan: {
            WEB_API: string[];
            WEB3: string[];
            PWN: string[];
            REV: string[];
            CRYPTO: string[];
            FORENSICS: string[];
            MISC: string[];
            UNKNOWN: string[];
        };
        execute: {
            WEB_API: string[];
            WEB3: string[];
            PWN: string[];
            REV: string[];
            CRYPTO: string[];
            FORENSICS: string[];
            MISC: string[];
            UNKNOWN: string[];
        };
    };
    by_subagent: {
        "aegis-plan": string[];
        "aegis-exec": string[];
        "bounty-scope": string[];
        "ctf-rev": string[];
        "ctf-pwn": string[];
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
    google_auth: z.ZodOptional<z.ZodBoolean>;
    disabled_mcps: z.ZodDefault<z.ZodArray<z.ZodString>>;
    strict_readiness: z.ZodDefault<z.ZodBoolean>;
    enable_injection_logging: z.ZodDefault<z.ZodBoolean>;
    enforce_todo_single_in_progress: z.ZodDefault<z.ZodBoolean>;
    parallel: z.ZodDefault<z.ZodObject<{
        queue_enabled: z.ZodDefault<z.ZodBoolean>;
        max_concurrent_per_provider: z.ZodDefault<z.ZodNumber>;
        provider_caps: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
        auto_dispatch_scan: z.ZodDefault<z.ZodBoolean>;
        auto_dispatch_hypothesis: z.ZodDefault<z.ZodBoolean>;
        bounty_scan: z.ZodDefault<z.ZodObject<{
            max_tracks: z.ZodDefault<z.ZodNumber>;
            triage_tracks: z.ZodDefault<z.ZodNumber>;
            research_tracks: z.ZodDefault<z.ZodNumber>;
            scope_recheck_tracks: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    tool_output_truncator: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        persist_mask_sensitive: z.ZodDefault<z.ZodBoolean>;
        max_chars: z.ZodDefault<z.ZodNumber>;
        head_chars: z.ZodDefault<z.ZodNumber>;
        tail_chars: z.ZodDefault<z.ZodNumber>;
        per_tool_max_chars: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    }, z.core.$strip>>;
    context_injection: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        inject_agents_md: z.ZodDefault<z.ZodBoolean>;
        inject_readme_md: z.ZodDefault<z.ZodBoolean>;
        max_files: z.ZodDefault<z.ZodNumber>;
        max_chars_per_file: z.ZodDefault<z.ZodNumber>;
        max_total_chars: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    auto_loop: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        only_when_ultrawork: z.ZodDefault<z.ZodBoolean>;
        idle_delay_ms: z.ZodDefault<z.ZodNumber>;
        max_iterations: z.ZodDefault<z.ZodNumber>;
        stop_on_verified: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    target_detection: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        lock_after_first: z.ZodDefault<z.ZodBoolean>;
        only_in_scan: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    notes: z.ZodDefault<z.ZodObject<{
        root_dir: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    comment_checker: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        only_in_bounty: z.ZodDefault<z.ZodBoolean>;
        min_added_lines: z.ZodDefault<z.ZodNumber>;
        max_comment_ratio: z.ZodDefault<z.ZodNumber>;
        max_comment_lines: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    rules_injector: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        max_files: z.ZodDefault<z.ZodNumber>;
        max_chars_per_file: z.ZodDefault<z.ZodNumber>;
        max_total_chars: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    recovery: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        empty_message_sanitizer: z.ZodDefault<z.ZodBoolean>;
        auto_compact_on_context_failure: z.ZodDefault<z.ZodBoolean>;
        context_window_proactive_compaction: z.ZodDefault<z.ZodBoolean>;
        context_window_proactive_threshold_ratio: z.ZodDefault<z.ZodNumber>;
        context_window_proactive_rearm_ratio: z.ZodDefault<z.ZodNumber>;
        edit_error_hint: z.ZodDefault<z.ZodBoolean>;
        thinking_block_validator: z.ZodDefault<z.ZodBoolean>;
        non_interactive_env: z.ZodDefault<z.ZodBoolean>;
        session_recovery: z.ZodDefault<z.ZodBoolean>;
        context_window_recovery: z.ZodDefault<z.ZodBoolean>;
        context_window_recovery_cooldown_ms: z.ZodDefault<z.ZodNumber>;
        context_window_recovery_max_attempts_per_session: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    interactive: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        enabled_in_ctf: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    tui_notifications: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        throttle_ms: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    memory: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        storage_dir: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    sequential_thinking: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        activate_phases: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            SCAN: "SCAN";
            PLAN: "PLAN";
            EXECUTE: "EXECUTE";
        }>>>;
        activate_targets: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            WEB_API: "WEB_API";
            WEB3: "WEB3";
            PWN: "PWN";
            REV: "REV";
            CRYPTO: "CRYPTO";
            FORENSICS: "FORENSICS";
            MISC: "MISC";
            UNKNOWN: "UNKNOWN";
        }>>>;
        activate_on_stuck: z.ZodDefault<z.ZodBoolean>;
        disable_with_thinking_model: z.ZodDefault<z.ZodBoolean>;
        tool_name: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>;
    ctf_fast_verify: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        enforce_all_targets: z.ZodDefault<z.ZodBoolean>;
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
        include_apex_for_wildcard_allow: z.ZodDefault<z.ZodBoolean>;
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
    skill_autoload: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        max_skills: z.ZodDefault<z.ZodNumber>;
        ctf: z.ZodDefault<z.ZodObject<{
            scan: z.ZodObject<{
                WEB_API: z.ZodDefault<z.ZodArray<z.ZodString>>;
                WEB3: z.ZodDefault<z.ZodArray<z.ZodString>>;
                PWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
                REV: z.ZodDefault<z.ZodArray<z.ZodString>>;
                CRYPTO: z.ZodDefault<z.ZodArray<z.ZodString>>;
                FORENSICS: z.ZodDefault<z.ZodArray<z.ZodString>>;
                MISC: z.ZodDefault<z.ZodArray<z.ZodString>>;
                UNKNOWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            plan: z.ZodObject<{
                WEB_API: z.ZodDefault<z.ZodArray<z.ZodString>>;
                WEB3: z.ZodDefault<z.ZodArray<z.ZodString>>;
                PWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
                REV: z.ZodDefault<z.ZodArray<z.ZodString>>;
                CRYPTO: z.ZodDefault<z.ZodArray<z.ZodString>>;
                FORENSICS: z.ZodDefault<z.ZodArray<z.ZodString>>;
                MISC: z.ZodDefault<z.ZodArray<z.ZodString>>;
                UNKNOWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            execute: z.ZodObject<{
                WEB_API: z.ZodDefault<z.ZodArray<z.ZodString>>;
                WEB3: z.ZodDefault<z.ZodArray<z.ZodString>>;
                PWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
                REV: z.ZodDefault<z.ZodArray<z.ZodString>>;
                CRYPTO: z.ZodDefault<z.ZodArray<z.ZodString>>;
                FORENSICS: z.ZodDefault<z.ZodArray<z.ZodString>>;
                MISC: z.ZodDefault<z.ZodArray<z.ZodString>>;
                UNKNOWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        bounty: z.ZodDefault<z.ZodObject<{
            scan: z.ZodObject<{
                WEB_API: z.ZodDefault<z.ZodArray<z.ZodString>>;
                WEB3: z.ZodDefault<z.ZodArray<z.ZodString>>;
                PWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
                REV: z.ZodDefault<z.ZodArray<z.ZodString>>;
                CRYPTO: z.ZodDefault<z.ZodArray<z.ZodString>>;
                FORENSICS: z.ZodDefault<z.ZodArray<z.ZodString>>;
                MISC: z.ZodDefault<z.ZodArray<z.ZodString>>;
                UNKNOWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            plan: z.ZodObject<{
                WEB_API: z.ZodDefault<z.ZodArray<z.ZodString>>;
                WEB3: z.ZodDefault<z.ZodArray<z.ZodString>>;
                PWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
                REV: z.ZodDefault<z.ZodArray<z.ZodString>>;
                CRYPTO: z.ZodDefault<z.ZodArray<z.ZodString>>;
                FORENSICS: z.ZodDefault<z.ZodArray<z.ZodString>>;
                MISC: z.ZodDefault<z.ZodArray<z.ZodString>>;
                UNKNOWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
            execute: z.ZodObject<{
                WEB_API: z.ZodDefault<z.ZodArray<z.ZodString>>;
                WEB3: z.ZodDefault<z.ZodArray<z.ZodString>>;
                PWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
                REV: z.ZodDefault<z.ZodArray<z.ZodString>>;
                CRYPTO: z.ZodDefault<z.ZodArray<z.ZodString>>;
                FORENSICS: z.ZodDefault<z.ZodArray<z.ZodString>>;
                MISC: z.ZodDefault<z.ZodArray<z.ZodString>>;
                UNKNOWN: z.ZodDefault<z.ZodArray<z.ZodString>>;
            }, z.core.$strip>;
        }, z.core.$strip>>;
        by_subagent: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>;
    }, z.core.$strip>>;
    auto_triage: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    flag_detector: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        custom_patterns: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    pattern_matcher: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
    recon_pipeline: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        max_commands_per_phase: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    delta_scan: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        max_age_ms: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    report_generator: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RouteTargetMap = z.infer<typeof TargetRouteMapSchema>;
export type RoutingConfig = z.infer<typeof RoutingSchema>;
export type CapabilityProfiles = z.infer<typeof CapabilityProfilesSchema>;
export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;
export {};
