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

// ─── Domain-specific CTF Recon Strategies ───

export function planCryptoRecon(target: string): ReconPhase {
  return {
    phase: 1,
    name: "Crypto Recon",
    tracks: [
      {
        purpose: "crypto-param-extraction",
        agent: "ctf-crypto",
        prompt: [
          `[CTF Crypto Recon: Parameter Extraction]`,
          `Target: ${target}`,
          "Extract all cryptographic parameters: key sizes, moduli (n), exponents (e,d), IVs, ciphertexts, block sizes.",
          "Check factordb.com for known factorizations of any RSA moduli.",
          "Identify the cryptosystem and list applicable known attacks.",
        ].join("\n"),
      },
      {
        purpose: "crypto-oracle-probing",
        agent: "ctf-crypto",
        prompt: [
          `[CTF Crypto Recon: Oracle Analysis]`,
          `Target: ${target}`,
          "If an encryption/decryption oracle is available, probe it with controlled inputs.",
          "Determine: block size, padding scheme, mode of operation, error oracle behavior.",
          "Identify if padding oracle, ECB detection, or chosen-plaintext attacks apply.",
        ].join("\n"),
      },
    ],
  };
}

export function planForensicsRecon(target: string): ReconPhase {
  return {
    phase: 1,
    name: "Forensics Recon",
    tracks: [
      {
        purpose: "forensics-file-analysis",
        agent: "ctf-forensics",
        prompt: [
          `[CTF Forensics Recon: File Analysis]`,
          `Target: ${target}`,
          "Run file/binwalk/exiftool on all artifacts. Identify true file types regardless of extensions.",
          "Check for embedded files, appended data, and suspicious metadata.",
          "Hash all artifacts (sha256) for chain-of-custody tracking.",
        ].join("\n"),
      },
      {
        purpose: "forensics-timeline-metadata",
        agent: "ctf-forensics",
        prompt: [
          `[CTF Forensics Recon: Timeline & Metadata]`,
          `Target: ${target}`,
          "Extract timestamps, EXIF data, filesystem metadata from all artifacts.",
          "Build a timeline of events if multiple artifacts with temporal data exist.",
          "Look for timestamp anomalies, GPS coordinates, author info, software versions.",
        ].join("\n"),
      },
    ],
  };
}

export function planPwnRecon(target: string): ReconPhase {
  return {
    phase: 1,
    name: "PWN Recon",
    tracks: [
      {
        purpose: "pwn-binary-analysis",
        agent: "ctf-pwn",
        prompt: [
          `[CTF PWN Recon: Binary Analysis]`,
          `Target: ${target}`,
          "Run checksec, file, readelf -h, readelf -S on the binary.",
          "Identify: architecture, protections (NX/PIE/canary/RELRO), linked libraries.",
          "Run ldd to check libc version; use ctf_libc_lookup if needed.",
          "Identify input channels: stdin, argv, file, network socket.",
        ].join("\n"),
      },
      {
        purpose: "pwn-vuln-class-id",
        agent: "ctf-pwn",
        prompt: [
          `[CTF PWN Recon: Vulnerability Classification]`,
          `Target: ${target}`,
          "Identify the vulnerability class: buffer overflow, format string, heap, use-after-free, race condition.",
          "Find dangerous functions: gets, strcpy, sprintf, system, execve.",
          "Map control flow from input to dangerous sink.",
          "Use ctf_pattern_match targetType=PWN for automated pattern detection.",
        ].join("\n"),
      },
    ],
  };
}

export function planRevRecon(target: string): ReconPhase {
  return {
    phase: 1,
    name: "REV Recon",
    tracks: [
      {
        purpose: "rev-structure-analysis",
        agent: "ctf-rev",
        prompt: [
          `[CTF REV Recon: Structure Analysis]`,
          `Target: ${target}`,
          "Run readelf -S to map all sections. Flag non-standard sections.",
          "Run readelf -r to check relocations. Use ctf_rev_loader_vm_detect on output.",
          "Identify: packer/protector, anti-debug, VM/interpreter patterns.",
          "Run strings to find function names, error messages, format strings.",
        ].join("\n"),
      },
      {
        purpose: "rev-logic-mapping",
        agent: "ctf-rev",
        prompt: [
          `[CTF REV Recon: Logic Mapping]`,
          `Target: ${target}`,
          "Identify the main validation/check function.",
          "Map the data flow: input → transformation → comparison → result.",
          "Determine if constraints are solvable symbolically (z3/angr) or require dynamic extraction.",
          "Check ctf_replay_safety_check to determine if standalone execution is reliable.",
        ].join("\n"),
      },
    ],
  };
}

export function planMiscRecon(target: string): ReconPhase {
  return {
    phase: 1,
    name: "MISC Recon",
    tracks: [
      {
        purpose: "misc-format-detection",
        agent: "ctf-explore",
        prompt: [
          `[CTF MISC Recon: Format Detection]`,
          `Target: ${target}`,
          "Identify all file formats, encodings, and data types present.",
          "Check for: base64/32/85, hex, rot13, custom alphabets, nested encodings.",
          "Look for esoteric languages (brainfuck, whitespace, piet, etc.).",
          "Check for QR codes, barcodes, or visual patterns in images.",
        ].join("\n"),
      },
      {
        purpose: "misc-context-clues",
        agent: "ctf-explore",
        prompt: [
          `[CTF MISC Recon: Context Clues]`,
          `Target: ${target}`,
          "Analyze challenge title, description, and metadata for hints.",
          "Check for OSINT pivot points: usernames, URLs, coordinates, dates.",
          "Look for patterns in filenames, directory structure, or hidden text.",
        ].join("\n"),
      },
    ],
  };
}

export function planWebRecon(target: string): ReconPhase {
  return {
    phase: 1,
    name: "WEB Recon",
    tracks: [
      {
        purpose: "web-stack-fingerprint",
        agent: "ctf-web",
        prompt: [
          `[CTF WEB Recon: Stack Fingerprinting]`,
          `Target: ${target}`,
          "Identify web stack: framework (Flask/Django/Express/Spring/PHP), language, server.",
          "Check response headers, cookies, error pages, and source code for clues.",
          "Map all endpoints, parameters, and input vectors.",
        ].join("\n"),
      },
      {
        purpose: "web-attack-surface",
        agent: "ctf-web",
        prompt: [
          `[CTF WEB Recon: Attack Surface]`,
          `Target: ${target}`,
          "Enumerate attack surface: forms, API endpoints, file uploads, auth mechanisms.",
          "Use ctf_pattern_match targetType=WEB_API for vulnerability pattern detection.",
          "Identify the most likely vulnerability class based on stack and behavior.",
        ].join("\n"),
      },
    ],
  };
}

export function planWeb3Recon(target: string): ReconPhase {
  return {
    phase: 1,
    name: "WEB3 Recon",
    tracks: [
      {
        purpose: "web3-contract-analysis",
        agent: "ctf-web3",
        prompt: [
          `[CTF WEB3 Recon: Contract Analysis]`,
          `Target: ${target}`,
          "Identify target contracts, chain, and available source code.",
          "If Solidity source available: check for reentrancy, access control, oracle issues.",
          "If bytecode only: decompile and identify key functions.",
          "Map contract interactions and token flows.",
        ].join("\n"),
      },
      {
        purpose: "web3-state-analysis",
        agent: "ctf-web3",
        prompt: [
          `[CTF WEB3 Recon: State Analysis]`,
          `Target: ${target}`,
          "Read contract storage slots to understand current state.",
          "Identify privileged roles, pausable mechanisms, and upgrade patterns.",
          "Check for flash-loan, oracle, or cross-contract interaction vulnerabilities.",
        ].join("\n"),
      },
    ],
  };
}

/**
 * Build a domain-aware CTF recon plan based on target type.
 */
export function planDomainRecon(
  targetType: string,
  target: string,
): ReconPhase | null {
  switch (targetType) {
    case "WEB_API": return planWebRecon(target);
    case "WEB3": return planWeb3Recon(target);
    case "PWN": return planPwnRecon(target);
    case "REV": return planRevRecon(target);
    case "CRYPTO": return planCryptoRecon(target);
    case "FORENSICS": return planForensicsRecon(target);
    case "MISC":
    case "UNKNOWN":
      return planMiscRecon(target);
    default: return null;
  }
}
