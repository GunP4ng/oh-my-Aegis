export interface EnvInfo {
  arch: string;
  libcVersion?: string;
  libcPath?: string;
  ldPath?: string;
  pythonVersion?: string;
  dockerImage?: string;
  seccompProfile?: string;
}

export interface ParityCheck {
  aspect: string;
  local: string;
  remote: string;
  match: boolean;
  fixCommand?: string;
}

export interface ParityReport {
  checks: ParityCheck[];
  allMatch: boolean;
  fixCommands: string[];
  summary: string;
}

const UNKNOWN_VALUE = "unknown";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeArch(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["amd64", "x86_64", "x64"].includes(normalized)) {
    return "x86_64";
  }
  if (["i386", "386", "x86"].includes(normalized)) {
    return "i386";
  }
  if (["arm64", "aarch64"].includes(normalized)) {
    return "aarch64";
  }
  return normalized;
}

function normalizeVersion(value: string | undefined): string | undefined {
  const input = (value ?? "").trim();
  if (!input) {
    return undefined;
  }
  const match = input.match(/\d+\.\d+(?:\.\d+)?/);
  return match?.[0];
}

function toDisplay(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : UNKNOWN_VALUE;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function sanitizePath(rawPath: string): string {
  return rawPath.replace(/[)"']+$/g, "").trim();
}

function dockerPlatformFromArch(arch: string | undefined): string | undefined {
  const normalized = normalizeArch(arch);
  if (!normalized) {
    return undefined;
  }
  if (normalized === "x86_64") {
    return "linux/amd64";
  }
  if (normalized === "i386") {
    return "linux/386";
  }
  if (normalized === "aarch64") {
    return "linux/arm64";
  }
  return undefined;
}

/**
 * Parse Dockerfile content and extract environment hints.
 */
export function parseDockerfile(content: string): Partial<EnvInfo> {
  const text = content.replace(/\r/g, "");
  const result: Partial<EnvInfo> = {};

  const fromMatch = text.match(/^FROM\s+(?:--platform=([^\s]+)\s+)?([^\s]+)(?:\s+AS\s+[^\s]+)?/im);
  if (fromMatch) {
    const platform = trimOrUndefined(fromMatch[1]);
    const image = trimOrUndefined(fromMatch[2]);

    if (image) {
      result.dockerImage = image;
      if (/python:(\d+\.\d+(?:\.\d+)?)/i.test(image)) {
        const version = image.match(/python:(\d+\.\d+(?:\.\d+)?)/i)?.[1];
        result.pythonVersion = normalizeVersion(version);
      }
      if (/arm64|aarch64/i.test(image)) {
        result.arch = "aarch64";
      } else if (/amd64|x86_64/i.test(image)) {
        result.arch = "x86_64";
      }
    }

    if (platform) {
      const archFromPlatform = platform.split("/").at(-1);
      const normalized = normalizeArch(archFromPlatform);
      if (normalized) {
        result.arch = normalized;
      }
    }
  }

  const glibcMatches = [
    text.match(/(?:GLIBC_VERSION|GLIBC)\s*[= ]\s*["']?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i)?.[1],
    text.match(/libc6(?:[:=][^\s]+)?[= ]([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i)?.[1],
    text.match(/libc-([0-9]+\.[0-9]+(?:\.[0-9]+)?)\.so/i)?.[1],
  ]
    .map((value) => normalizeVersion(value))
    .filter((value): value is string => Boolean(value));

  if (glibcMatches.length > 0) {
    result.libcVersion = glibcMatches[0];
  }

  const libcPathMatch = text.match(/(\/[^\s"']*libc(?:-[0-9.]+)?\.so(?:\.6)?)/i)?.[1];
  if (libcPathMatch) {
    result.libcPath = sanitizePath(libcPathMatch);
  }

  const ldPathMatch = text.match(/(\/[^\s"']*ld-linux[^\s"']*)/i)?.[1] ?? text.match(/(\/[^\s"']*ld-[^\s"']*\.so[^\s"']*)/i)?.[1];
  if (ldPathMatch) {
    result.ldPath = sanitizePath(ldPathMatch);
  }

  const pythonVersionMatch =
    text.match(/python(?:3)?(?:[:= ]|\s)([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i)?.[1] ??
    text.match(/python3\.[0-9]+/i)?.[0]?.replace(/^python/i, "");
  if (pythonVersionMatch) {
    result.pythonVersion = normalizeVersion(pythonVersionMatch);
  }

  const seccompMatch =
    text.match(/SECCOMP_PROFILE\s*=\s*["']?([^\s"']+)/i)?.[1] ??
    text.match(/--security-opt\s+seccomp=([^\s]+)/i)?.[1];
  if (seccompMatch) {
    result.seccompProfile = seccompMatch.trim();
  }

  result.arch = normalizeArch(result.arch);
  result.libcVersion = normalizeVersion(result.libcVersion);

  return result;
}

/**
 * Generate local shell commands to detect environment properties.
 */
export function localEnvCommands(): string[] {
  return [
    "uname -m",
    "ldd --version 2>&1 | head -n 1",
    "python3 --version 2>&1 || python --version 2>&1",
    "readlink -f /lib64/ld-linux-x86-64.so.2 2>/dev/null || readlink -f /lib/ld-linux.so.2 2>/dev/null || true",
    "grep -E '^(NAME|VERSION)=' /etc/os-release 2>/dev/null || true",
  ];
}

/**
 * Parse ldd output and extract libc path/version if available.
 */
export function parseLddOutput(output: string): { libcPath: string; version: string } | null {
  const text = output.replace(/\r/g, "");
  if (!text.trim()) {
    return null;
  }

  const pathMatch =
    text.match(/libc\.so\.6\s*=>\s*(\/[^\s]+)\s*\(/i)?.[1] ??
    text.match(/(\/[^\s]*libc(?:-[0-9.]+)?\.so(?:\.6)?)/i)?.[1];
  const libcPath = trimOrUndefined(pathMatch ? sanitizePath(pathMatch) : undefined);
  if (!libcPath) {
    return null;
  }

  const version =
    normalizeVersion(text.match(/(?:GLIBC|GNU libc|ldd)[^0-9]*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i)?.[1]) ??
    normalizeVersion(libcPath.match(/libc-([0-9]+\.[0-9]+(?:\.[0-9]+)?)\.so/i)?.[1]) ??
    "unknown";

  return { libcPath, version };
}

/**
 * Generate patchelf commands to align local binary against remote runtime.
 */
export function generatePatchelfCommands(binaryPath: string, env: EnvInfo): string[] {
  const commands: string[] = [];
  const targetBinary = binaryPath.trim();

  if (!targetBinary) {
    return commands;
  }

  const ldPath = trimOrUndefined(env.ldPath);
  const libcPath = trimOrUndefined(env.libcPath);

  if (ldPath) {
    commands.push(`patchelf --set-interpreter ${shellQuote(ldPath)} ${shellQuote(targetBinary)}`);
  }

  if (libcPath) {
    commands.push(`patchelf --replace-needed libc.so.6 ${shellQuote(libcPath)} ${shellQuote(targetBinary)}`);
    const slashIndex = libcPath.lastIndexOf("/");
    if (slashIndex > 0) {
      const libcDir = libcPath.slice(0, slashIndex);
      commands.push(`patchelf --set-rpath ${shellQuote(libcDir)} ${shellQuote(targetBinary)}`);
    }
  }

  return commands;
}

/**
 * Generate a docker run command approximating the remote environment.
 */
export function generateDockerCommand(env: EnvInfo, binaryPath: string): string {
  const image = trimOrUndefined(env.dockerImage) ?? "ubuntu:22.04";
  const platform = dockerPlatformFromArch(env.arch);

  const normalizedBinary = binaryPath.trim() || "./a.out";
  const slashIndex = normalizedBinary.lastIndexOf("/");
  const workDir = slashIndex > 0 ? normalizedBinary.slice(0, slashIndex) : ".";
  const binaryName = slashIndex >= 0 ? normalizedBinary.slice(slashIndex + 1) : normalizedBinary;
  const inContainerPath = `./${binaryName}`;

  const parts: string[] = ["docker run --rm -it"];
  if (platform) {
    parts.push(`--platform ${platform}`);
  }
  if (env.seccompProfile?.trim()) {
    parts.push(`--security-opt seccomp=${shellQuote(env.seccompProfile.trim())}`);
  }
  parts.push(`-v ${shellQuote(workDir)}:/work -w /work`);
  parts.push(image);
  parts.push(inContainerPath);

  return parts.join(" ");
}

/**
 * Build parity checks between local and remote environment descriptors.
 */
export function buildParityReport(local: Partial<EnvInfo>, remote: Partial<EnvInfo>): ParityReport {
  const checks: ParityCheck[] = [];

  const normalizedLocalArch = normalizeArch(local.arch);
  const normalizedRemoteArch = normalizeArch(remote.arch);
  const normalizedLocalLibc = normalizeVersion(local.libcVersion) ?? trimOrUndefined(local.libcPath);
  const normalizedRemoteLibc = normalizeVersion(remote.libcVersion) ?? trimOrUndefined(remote.libcPath);

  const addCheck = (args: {
    aspect: string;
    localValue?: string;
    remoteValue?: string;
    fixCommand?: string;
  }): void => {
    const localDisplay = toDisplay(args.localValue);
    const remoteDisplay = toDisplay(args.remoteValue);
    const bothUnknown = localDisplay === UNKNOWN_VALUE && remoteDisplay === UNKNOWN_VALUE;
    const match =
      !bothUnknown &&
      localDisplay !== UNKNOWN_VALUE &&
      remoteDisplay !== UNKNOWN_VALUE &&
      localDisplay === remoteDisplay;

    checks.push({
      aspect: args.aspect,
      local: localDisplay,
      remote: remoteDisplay,
      match,
      fixCommand: match ? undefined : args.fixCommand,
    });
  };

  addCheck({
    aspect: "arch",
    localValue: normalizedLocalArch,
    remoteValue: normalizedRemoteArch,
    fixCommand:
      normalizedRemoteArch !== undefined
        ? `Use docker platform ${dockerPlatformFromArch(normalizedRemoteArch) ?? normalizedRemoteArch} for execution parity.`
        : undefined,
  });

  addCheck({
    aspect: "libc",
    localValue: normalizedLocalLibc,
    remoteValue: normalizedRemoteLibc,
    fixCommand:
      remote.libcPath || remote.ldPath
        ? generatePatchelfCommands("<binary>", {
            arch: normalizedRemoteArch ?? "unknown",
            libcPath: trimOrUndefined(remote.libcPath),
            ldPath: trimOrUndefined(remote.ldPath),
            libcVersion: normalizeVersion(remote.libcVersion),
          } as EnvInfo).join(" && ")
        : undefined,
  });

  addCheck({
    aspect: "ld",
    localValue: trimOrUndefined(local.ldPath),
    remoteValue: trimOrUndefined(remote.ldPath),
    fixCommand: remote.ldPath?.trim() ? `patchelf --set-interpreter ${shellQuote(remote.ldPath.trim())} <binary>` : undefined,
  });

  addCheck({
    aspect: "python",
    localValue: normalizeVersion(local.pythonVersion) ?? trimOrUndefined(local.pythonVersion),
    remoteValue: normalizeVersion(remote.pythonVersion) ?? trimOrUndefined(remote.pythonVersion),
    fixCommand: remote.pythonVersion?.trim() ? `pyenv install ${remote.pythonVersion.trim()} && pyenv local ${remote.pythonVersion.trim()}` : undefined,
  });

  addCheck({
    aspect: "seccomp",
    localValue: trimOrUndefined(local.seccompProfile),
    remoteValue: trimOrUndefined(remote.seccompProfile),
    fixCommand: remote.seccompProfile?.trim() ? `docker run --security-opt seccomp=${shellQuote(remote.seccompProfile.trim())} ...` : undefined,
  });

  const fixCommands = Array.from(
    new Set(
      checks
        .filter((check) => !check.match && check.fixCommand)
        .map((check) => check.fixCommand as string)
        .map((command) => command.trim())
        .filter(Boolean)
    )
  );

  const allMatch = checks.every((check) => check.match);
  const summaryLines: string[] = [`Parity checks: ${checks.filter((check) => check.match).length}/${checks.length} matched.`];

  if (allMatch) {
    summaryLines.push("Local and remote environment appear aligned for tracked aspects.");
  } else {
    const mismatches = checks.filter((check) => !check.match).map((check) => check.aspect);
    summaryLines.push(`Mismatched aspects: ${mismatches.join(", ")}.`);
    const unknownAspects = checks
      .filter((check) => check.local === UNKNOWN_VALUE && check.remote === UNKNOWN_VALUE)
      .map((check) => check.aspect);
    if (unknownAspects.length > 0) {
      summaryLines.push(`Unknown parity aspects: ${unknownAspects.join(", ")} (treat as mismatch until evidence exists).`);
    }
    if (fixCommands.length > 0) {
      summaryLines.push(`Suggested fixes: ${fixCommands.length} command(s) generated.`);
    }
  }

  return {
    checks,
    allMatch,
    fixCommands,
    summary: summaryLines.join(" "),
  };
}

/**
 * Build a prompt-ready parity summary with prioritized fixes.
 */
export function buildParitySummary(report: ParityReport): string {
  const lines: string[] = [report.summary];

  for (const check of report.checks) {
    const status = check.match ? "OK" : "MISMATCH";
    lines.push(`- [${status}] ${check.aspect}: local=${check.local} remote=${check.remote}`);
  }

  if (!report.allMatch && report.fixCommands.length > 0) {
    lines.push("Fix commands:");
    for (const command of report.fixCommands) {
      lines.push(`- ${command}`);
    }
  }

  return lines.join("\n");
}
