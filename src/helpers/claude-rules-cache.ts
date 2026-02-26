import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isRecord } from "../utils/is-record";
import { escapeRegExp, globToRegExp } from "./plugin-utils";

export interface DenyRule {
  raw: string;
  re: RegExp;
}

export interface ClaudeRuleEntry {
  sourcePath: string;
  relPath: string;
  body: string;
  pathGlobs: string[];
  pathRes: RegExp[];
}

export interface ClaudeDenyCacheData {
  lastLoadAt: number;
  sourceMtimeMs: number;
  sourcePaths: string[];
  denyBash: DenyRule[];
  denyRead: DenyRule[];
  denyEdit: DenyRule[];
  warnings: string[];
}

export interface ClaudeRulesCacheData {
  lastLoadAt: number;
  sourceMtimeMs: number;
  rules: ClaudeRuleEntry[];
  warnings: string[];
}

export class ClaudeRulesCache {
  private directory: string;
  private denyCache: ClaudeDenyCacheData = {
    lastLoadAt: 0,
    sourceMtimeMs: 0,
    sourcePaths: [],
    denyBash: [],
    denyRead: [],
    denyEdit: [],
    warnings: [],
  };

  private rulesCache: ClaudeRulesCacheData = {
    lastLoadAt: 0,
    sourceMtimeMs: 0,
    rules: [],
    warnings: [],
  };

  constructor(directory: string) {
    this.directory = directory;
  }

  getDenyRules(): ClaudeDenyCacheData {
    const now = Date.now();
    if (now - this.denyCache.lastLoadAt < 60_000) {
      return this.denyCache;
    }
    this.loadDenyRules();
    return this.denyCache;
  }

  getRules(): ClaudeRulesCacheData {
    const now = Date.now();
    if (now - this.rulesCache.lastLoadAt < 60_000) {
      return this.rulesCache;
    }
    this.loadRules();
    return this.rulesCache;
  }

  private loadDenyRules(): void {
    const settingsDir = join(this.directory, ".claude");
    const candidates = [
      join(settingsDir, "settings.json"),
      join(settingsDir, "settings.local.json"),
    ];

    const sourcePaths = candidates.filter((p) => existsSync(p));
    let sourceMtimeMs = 0;
    for (const p of sourcePaths) {
      try {
        const st = statSync(p);
        sourceMtimeMs = Math.max(sourceMtimeMs, st.mtimeMs);
      } catch {
        continue;
      }
    }

    const denyStrings: string[] = [];
    const warnings: string[] = [];
    const collectDeny = (path: string): void => {
      let raw = "";
      try {
        raw = readFileSync(path, "utf-8");
      } catch {
        warnings.push(`Failed to read Claude settings: ${relative(this.directory, path)}`);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        warnings.push(`Failed to parse Claude settings JSON: ${relative(this.directory, path)}`);
        return;
      }
      if (!isRecord(parsed)) {
        warnings.push(`Claude settings root is not an object: ${relative(this.directory, path)}`);
        return;
      }
      const permissions = (parsed as Record<string, unknown>).permissions;
      if (!isRecord(permissions)) {
        return;
      }
      const deny = (permissions as Record<string, unknown>).deny;
      if (!Array.isArray(deny)) {
        return;
      }
      for (const entry of deny) {
        if (typeof entry === "string" && entry.trim().length > 0) {
          denyStrings.push(entry.trim());
        }
      }
    };

    for (const p of sourcePaths) {
      collectDeny(p);
    }

    const denyBash: DenyRule[] = [];
    const denyRead: DenyRule[] = [];
    const denyEdit: DenyRule[] = [];

    const toAbsPathGlob = (spec: string): string | null => {
      const trimmed = spec.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("//")) {
        return resolve("/", trimmed.slice(2));
      }
      if (trimmed.startsWith("~")) {
        const home = process.env.HOME || process.env.USERPROFILE;
        if (!home) return null;
        return resolve(home, trimmed.slice(1));
      }
      if (trimmed.startsWith("/")) {
        return resolve(settingsDir, trimmed.slice(1));
      }
      if (trimmed.startsWith("./")) {
        return resolve(this.directory, trimmed.slice(2));
      }
      return resolve(this.directory, trimmed);
    };

    for (const item of denyStrings) {
      const match = item.match(/^(Read|Edit|Bash)\((.*)\)$/);
      if (!match) {
        continue;
      }
      const kind = match[1];
      const spec = match[2] ?? "";
      if (kind === "Bash") {
        const escaped = escapeRegExp(spec);
        const re = new RegExp(`^${escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`, "i");
        denyBash.push({ raw: item, re });
        continue;
      }

      const absGlob = toAbsPathGlob(spec);
      if (!absGlob) {
        continue;
      }
      let re: RegExp;
      try {
        re = globToRegExp(absGlob);
      } catch {
        continue;
      }
      if (kind === "Read") {
        denyRead.push({ raw: item, re });
      } else {
        denyEdit.push({ raw: item, re });
      }
    }

    this.denyCache.lastLoadAt = Date.now();
    this.denyCache.sourceMtimeMs = sourceMtimeMs;
    this.denyCache.sourcePaths = sourcePaths;
    this.denyCache.denyBash = denyBash;
    this.denyCache.denyRead = denyRead;
    this.denyCache.denyEdit = denyEdit;
    this.denyCache.warnings = warnings;
  }

  private loadRules(): void {
    const rulesDir = join(this.directory, ".claude", "rules");
    const warnings: string[] = [];
    const rules: ClaudeRuleEntry[] = [];
    let sourceMtimeMs = 0;
    if (!existsSync(rulesDir)) {
      this.rulesCache.lastLoadAt = Date.now();
      this.rulesCache.sourceMtimeMs = 0;
      this.rulesCache.rules = [];
      this.rulesCache.warnings = [];
      return;
    }

    const mdFiles: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 12) return;
      let entries: Array<{ name: string; path: string; isDir: boolean; isFile: boolean }> = [];
      try {
        const dirents = readdirSync(dir, { withFileTypes: true });
        entries = dirents.map((d) => ({
          name: d.name,
          path: join(dir, d.name),
          isDir: d.isDirectory(),
          isFile: d.isFile(),
        }));
      } catch {
        warnings.push(`Failed to scan Claude rules dir: ${relative(this.directory, dir)}`);
        return;
      }

      for (const entry of entries) {
        if (mdFiles.length >= 80) {
          return;
        }
        if (entry.isDir) {
          walk(entry.path, depth + 1);
          continue;
        }
        if (!entry.isFile) {
          continue;
        }
        if (entry.name.toLowerCase().endsWith(".md")) {
          mdFiles.push(entry.path);
        }
      }
    };
    walk(rulesDir, 0);

    for (const filePath of mdFiles) {
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(filePath);
        sourceMtimeMs = Math.max(sourceMtimeMs, st.mtimeMs);
      } catch {
        continue;
      }
      if (!st.isFile()) {
        continue;
      }
      if (st.size > 256 * 1024) {
        warnings.push(`Skipped large Claude rule file: ${relative(this.directory, filePath)}`);
        continue;
      }
      let text = "";
      try {
        text = readFileSync(filePath, "utf-8");
      } catch {
        warnings.push(`Failed to read Claude rule file: ${relative(this.directory, filePath)}`);
        continue;
      }
      const parsed = ClaudeRulesCache.parseFrontmatterPaths(text);
      const rel = relative(this.directory, filePath);
      const body = parsed.body.trim();
      const globs = parsed.paths.map((p) => p.trim()).filter(Boolean);
      const res: RegExp[] = [];
      for (const glob of globs) {
        try {
          res.push(globToRegExp(glob));
        } catch {
          continue;
        }
      }
      rules.push({
        sourcePath: filePath,
        relPath: rel,
        body,
        pathGlobs: globs,
        pathRes: res,
      });
    }

    this.rulesCache.lastLoadAt = Date.now();
    this.rulesCache.sourceMtimeMs = sourceMtimeMs;
    this.rulesCache.rules = rules;
    this.rulesCache.warnings = warnings;
  }

  static parseFrontmatterPaths(text: string): { body: string; paths: string[] } {
    const lines = text.split(/\r?\n/);
    if (lines.length < 3 || lines[0].trim() !== "---") {
      return { body: text, paths: [] };
    }
    let endIdx = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) {
      return { body: text, paths: [] };
    }
    const fm = lines.slice(1, endIdx);
    const body = lines.slice(endIdx + 1).join("\n");

    const paths: string[] = [];
    let inPaths = false;
    for (const rawLine of fm) {
      const line = rawLine.trimEnd();
      if (!inPaths) {
        if (/^paths\s*:/i.test(line.trim())) {
          inPaths = true;
        }
        continue;
      }
      const m = line.match(/^\s*-\s*(.+)\s*$/);
      if (!m) {
        break;
      }
      let value = (m[1] ?? "").trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) {
        paths.push(value);
      }
    }

    return { body, paths };
  }
}
