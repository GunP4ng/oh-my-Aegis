import type { OrchestratorConfig } from "../config/schema";
import type { SessionState } from "../state/types";
import type { DispatchPlan } from "./parallel";

export interface ReconPhase {
  phase: number;
  name: string;
  tracks: DispatchPlan["tracks"];
}

function normalizeScope(scope: string[] | undefined, fallbackTarget: string): string[] {
  const cleaned = (scope ?? []).map((item) => item.trim()).filter(Boolean);
  if (cleaned.length > 0) {
    return cleaned;
  }
  return [fallbackTarget.trim() || "<target>"];
}

function buildGuardrailBlock(target: string, scope?: string[], scopeConfirmed?: boolean): string {
  const inScope = normalizeScope(scope, target);
  return [
    "Scope constraints:",
    `- In-scope assets only: ${inScope.join(", ")}`,
    scopeConfirmed
      ? "- Scope status: confirmed; still avoid out-of-scope pivots."
      : "- Scope status: unconfirmed; keep actions conservative and scope-safe.",
    "- Do not test third-party or unknown assets.",
    "Rate limiting reminders:",
    "- Use low request rates and small batches.",
    "- Back off immediately on 429/5xx spikes or instability.",
  ].join("\n");
}

function withGuardrails(prompt: string, target: string, scope?: string[], scopeConfirmed?: boolean): string {
  return `${prompt}\n\n${buildGuardrailBlock(target, scope, scopeConfirmed)}`;
}

/**
 * Phase 1 planning for asset discovery (subdomains and ports).
 */
export function planAssetDiscovery(target: string, scope?: string[]): ReconPhase {
  const tracks: DispatchPlan["tracks"] = [
    {
      purpose: "asset-discovery-subdomains",
      agent: "bounty-triage",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 1: Asset Discovery]`,
          `Target: ${target}`,
          "Enumerate candidate subdomains with passive-first methods and deduplicate results.",
          "Output should include: discovered assets, confidence, and one safest next recon step.",
        ].join("\n"),
        target,
        scope,
      ),
    },
    {
      purpose: "asset-discovery-ports",
      agent: "bounty-triage",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 1: Asset Discovery]`,
          `Target: ${target}`,
          "Perform conservative host/port triage on confirmed in-scope hosts.",
          "Prioritize lightweight checks and summarize live services by risk relevance.",
        ].join("\n"),
        target,
        scope,
      ),
    },
  ];

  return {
    phase: 1,
    name: "Asset Discovery",
    tracks,
  };
}

/**
 * Phase 2 planning for live host probing and technology triage.
 */
export function planLiveHostTriage(target: string): ReconPhase {
  const tracks: DispatchPlan["tracks"] = [
    {
      purpose: "live-host-http-probing",
      agent: "bounty-triage",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 2: Live Host Triage]`,
          `Target: ${target}`,
          "Probe candidate hosts for live HTTP(S) services and prioritize reachable assets.",
          "Capture status code clusters, titles, and high-value endpoints only.",
        ].join("\n"),
        target,
      ),
    },
    {
      purpose: "live-host-tech-detection",
      agent: "bounty-triage",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 2: Live Host Triage]`,
          `Target: ${target}`,
          "Fingerprint technologies/frameworks with low-impact techniques.",
          "Map likely attack surface categories without active exploitation.",
        ].join("\n"),
        target,
      ),
    },
  ];

  return {
    phase: 2,
    name: "Live Host Triage",
    tracks,
  };
}

/**
 * Phase 3 planning for endpoint/content discovery.
 */
export function planContentDiscovery(target: string): ReconPhase {
  const tracks: DispatchPlan["tracks"] = [
    {
      purpose: "content-discovery-crawl",
      agent: "bounty-research",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 3: Content Discovery]`,
          `Target: ${target}`,
          "Crawl known live hosts to discover endpoints, parameters, and API paths.",
          "Prioritize authenticated boundary indicators and sensitive data flows.",
        ].join("\n"),
        target,
      ),
    },
    {
      purpose: "content-discovery-directories",
      agent: "bounty-research",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 3: Content Discovery]`,
          `Target: ${target}`,
          "Run focused directory/content discovery with conservative wordlists and cadence.",
          "Report only high-signal findings and likely validation paths.",
        ].join("\n"),
        target,
      ),
    },
  ];

  return {
    phase: 3,
    name: "Content Discovery",
    tracks,
  };
}

/**
 * Phase 4 planning for vulnerability-focused scanning.
 */
export function planVulnScan(target: string): ReconPhase {
  const tracks: DispatchPlan["tracks"] = [
    {
      purpose: "vuln-scan-nuclei-focused",
      agent: "bounty-research",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 4: Vulnerability Scan]`,
          `Target: ${target}`,
          "Run focused vulnerability checks aligned to discovered technologies/assets.",
          "Prefer high-confidence templates/checks over broad noisy scanning.",
        ].join("\n"),
        target,
      ),
    },
    {
      purpose: "vuln-scan-focused-manual",
      agent: "bounty-research",
      prompt: withGuardrails(
        [
          `[BOUNTY Recon Phase 4: Vulnerability Scan]`,
          `Target: ${target}`,
          "Design minimal-impact manual checks for top candidate weaknesses.",
          "Return reproducible validation steps with strict scope safety.",
        ].join("\n"),
        target,
      ),
    },
  ];

  return {
    phase: 4,
    name: "Vulnerability Scan",
    tracks,
  };
}

/**
 * Build a multi-phase bounty recon dispatch plan.
 */
export function planReconPipeline(
  state: SessionState,
  config: OrchestratorConfig,
  target: string,
  options?: { scope?: string[]; maxTracksPerPhase?: number; skipPhases?: number[] },
): DispatchPlan {
  const normalizedTarget = target.trim() || "<target>";
  const scopedAssets = normalizeScope(options?.scope, normalizedTarget);
  const skip = new Set(options?.skipPhases ?? []);
  const maxTracksPerPhase =
    typeof options?.maxTracksPerPhase === "number" && options.maxTracksPerPhase > 0
      ? Math.floor(options.maxTracksPerPhase)
      : Number.MAX_SAFE_INTEGER;

  const phases: ReconPhase[] = [
    planAssetDiscovery(normalizedTarget, scopedAssets),
    planLiveHostTriage(normalizedTarget),
    planContentDiscovery(normalizedTarget),
    planVulnScan(normalizedTarget),
  ].filter((phase) => !skip.has(phase.phase));

  const scannerPolicyNote = config.bounty_policy.deny_scanner_commands
    ? "Scanner restrictions may apply; prefer scoped, low-noise checks."
    : "Scanner restrictions are relaxed; still stay conservative and in-scope.";

  const tracks: DispatchPlan["tracks"] = phases.flatMap((phase) =>
    phase.tracks.slice(0, maxTracksPerPhase).map((track, index) => ({
      purpose: `phase-${phase.phase}-${index + 1}-${track.purpose}`,
      agent: track.agent,
      prompt: `${track.prompt}\n\nScope status at pipeline build: ${state.scopeConfirmed ? "confirmed" : "unconfirmed"}.\nPolicy note: ${scannerPolicyNote}`,
    })),
  );

  const safeLabel = normalizedTarget.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "target";

  return {
    label: `bounty-recon-${safeLabel}`,
    tracks,
  };
}
