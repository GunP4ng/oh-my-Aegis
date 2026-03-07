/**
 * Domain-specific system prompts for all orchestration subagents.
 * Keyed by agent name as referenced in routing tables and AGENT_OVERRIDES.
 */
export declare const AGENT_PROMPTS: Record<string, string>;
/**
 * User-facing descriptions shown in the agent picker.
 */
export declare const AGENT_DESCRIPTIONS: Record<string, string>;
/**
 * Agents exposed as primary (selectable from the agent picker).
 * All others are hidden internal subagents.
 */
export declare const USER_SELECTABLE_AGENTS: Set<string>;
/**
 * Color palette for agent picker badges.
 */
export declare const AGENT_COLORS: Record<string, string>;
/**
 * Permission profiles for domain agents.
 */
export declare const AGENT_PERMISSIONS: Record<string, Record<string, string>>;
