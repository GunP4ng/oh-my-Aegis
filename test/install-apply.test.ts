import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyAegisConfig,
  resolveAntigravityAuthPluginEntry,
  resolveOpenAICodexAuthPluginEntry,
} from "../src/install/apply-config";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.length = 0;
});

function makeRoot(): string {
  const root = join(tmpdir(), `aegis-install-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  return root;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

describe("install apply config", () => {
  it("registers package plugin entry and bootstraps required mappings", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const env = {
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    const agent =
      typeof opencode.agent === "object" && opencode.agent
        ? (opencode.agent as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const mcp =
      typeof opencode.mcp === "object" && opencode.mcp
        ? (opencode.mcp as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const provider =
      typeof opencode.provider === "object" && opencode.provider
        ? (opencode.provider as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    const google = typeof (provider as Record<string, unknown>).google === "object" && (provider as Record<string, unknown>).google
      ? ((provider as Record<string, unknown>).google as Record<string, unknown>)
      : {};
    const googleModels =
      typeof google.models === "object" && google.models ? (google.models as Record<string, unknown>) : {};
    const openai = typeof (provider as Record<string, unknown>).openai === "object" && (provider as Record<string, unknown>).openai
      ? ((provider as Record<string, unknown>).openai as Record<string, unknown>)
      : {};
    const anthropic = typeof (provider as Record<string, unknown>).anthropic === "object" && (provider as Record<string, unknown>).anthropic
      ? ((provider as Record<string, unknown>).anthropic as Record<string, unknown>)
      : {};
    const openaiModels =
      typeof openai.models === "object" && openai.models ? (openai.models as Record<string, unknown>) : {};
    const anthropicModels =
      typeof anthropic.models === "object" && anthropic.models ? (anthropic.models as Record<string, unknown>) : {};
    const openaiOptions =
      typeof openai.options === "object" && openai.options ? (openai.options as Record<string, unknown>) : {};

    expect(plugin).toContain("oh-my-aegis");
    expect(plugin).toContain("opencode-antigravity-auth@latest");
    expect(plugin).toContain("opencode-openai-codex-auth@latest");
    expect(Object.prototype.hasOwnProperty.call(agent, "ctf-web3")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(agent, "ctf-verify")).toBe(true);
    const ctfWeb3 = agent["ctf-web3"] as Record<string, unknown>;
    expect(ctfWeb3.mode).toBe("subagent");
    expect(ctfWeb3.hidden).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(mcp, "context7")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(mcp, "grep_app")).toBe(true);
    expect(google.name).toBe("Google");
    expect(google.npm).toBe("@ai-sdk/google");
    expect(Object.prototype.hasOwnProperty.call(googleModels, "antigravity-gemini-3-pro")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(googleModels, "antigravity-gemini-3-flash")).toBe(true);
    const proModel = googleModels["antigravity-gemini-3-pro"] as Record<string, unknown>;
    const flashModel = googleModels["antigravity-gemini-3-flash"] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(proModel, "variants")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(flashModel, "variants")).toBe(false);
    expect(openai.name).toBe("OpenAI");
    expect(openaiOptions.reasoningEffort).toBe("medium");
    expect(Object.prototype.hasOwnProperty.call(openaiModels, "gpt-5.2")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(openaiModels, "gpt-5.2-codex")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(openaiModels, "gpt-5.1-codex-max")).toBe(true);
    expect(anthropic.name).toBe("Anthropic");
    expect((anthropic.npm as string).includes("@ai-sdk/anthropic")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(anthropicModels, "claude-sonnet-4.5")).toBe(true);
    const sonnetModel = anthropicModels["claude-sonnet-4.5"] as Record<string, unknown>;
    const sonnetVariants =
      typeof sonnetModel?.variants === "object" && sonnetModel.variants
        ? (sonnetModel.variants as Record<string, unknown>)
        : {};
    expect(Object.prototype.hasOwnProperty.call(sonnetVariants, "low")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sonnetVariants, "max")).toBe(true);
    expect(opencode.default_agent).toBe("Aegis");

    const aegis = readJson(result.aegisPath);
    expect(aegis.default_mode).toBe("BOUNTY");
    expect((aegis.auto_dispatch as Record<string, unknown>).operational_feedback_enabled).toBe(false);
    expect(result.backupPath).toBeNull();
  });

  it("resolves agent model by available provider environment", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const env = {
      XDG_CONFIG_HOME: xdg,
      GOOGLE_API_KEY: "dummy",
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
    });

    const opencode = readJson(result.opencodePath);
    const agent = typeof opencode.agent === "object" && opencode.agent ? (opencode.agent as Record<string, unknown>) : {};
    const ctfWeb = agent["ctf-web"] as Record<string, unknown> | undefined;
    expect(typeof ctfWeb).toBe("object");
    expect((ctfWeb?.model as string).startsWith("google/")).toBe(true);
  });

  it("creates backup when opencode.json already exists", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: true,
    });

    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath as string)).toBe(true);

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    expect(plugin).toContain("existing-plugin");
    expect(plugin).toContain("oh-my-aegis");
    expect(plugin).toContain("opencode-antigravity-auth@latest");
    expect(plugin).toContain("opencode-openai-codex-auth@latest");
  });

  it("forces default_agent to Aegis on install apply", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify({ default_agent: "build" }, null, 2)}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const agent = opencode.agent as Record<string, unknown>;
    const aegis = agent.Aegis as Record<string, unknown>;
    expect(opencode.default_agent).toBe("Aegis");
    expect(aegis.mode).toBe("primary");
  });

  it("removes legacy orchestrator agents and sequential-thinking MCP alias", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(
        {
          default_agent: "build",
          mcp: {
            "sequential-thinking": {
              type: "local",
              command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
            },
          },
          agent: {
            build: { model: "openai/gpt-5.3-codex" },
            prometheus: { model: "openai/gpt-5.3-codex" },
            hephaestus: { model: "openai/gpt-5.3-codex" },
          },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const mcp = opencode.mcp as Record<string, unknown>;
    const agent = opencode.agent as Record<string, unknown>;

    expect(opencode.default_agent).toBe("Aegis");
    expect(Object.prototype.hasOwnProperty.call(mcp, "sequential-thinking")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(mcp, "sequential_thinking")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(agent, "build")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(agent, "plan")).toBe(true);
    expect(((agent.build as Record<string, unknown>)?.mode as string) ?? "").toBe("subagent");
    expect(((agent.build as Record<string, unknown>)?.hidden as boolean) ?? false).toBe(true);
    expect(((agent.plan as Record<string, unknown>)?.mode as string) ?? "").toBe("subagent");
    expect(((agent.plan as Record<string, unknown>)?.hidden as boolean) ?? false).toBe(true);
    expect(((agent.Aegis as Record<string, unknown>)?.mode as string) ?? "").toBe("primary");
    expect(Object.prototype.hasOwnProperty.call(agent, "prometheus")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(agent, "hephaestus")).toBe(false);
  });

  it("reads and updates existing opencode.jsonc with comments", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.jsonc"),
      `{
  // existing config
  "plugin": ["existing-plugin"]
}
`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    expect(result.opencodePath.endsWith("opencode.jsonc")).toBe(true);
    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    expect(plugin).toContain("existing-plugin");
    expect(plugin).toContain("oh-my-aegis");
  });

  it("keeps existing google provider options while migrating legacy antigravity pro model keys", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(
        {
          provider: {
            google: {
              options: {
                clientId: "custom-client-id",
                clientSecret: "custom-client-secret",
              },
              models: {
                "antigravity-gemini-3-pro-high": {
                  name: "Custom Gemini Pro",
                },
              },
            },
          },
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const provider = opencode.provider as Record<string, unknown>;
    const google = provider.google as Record<string, unknown>;
    const options = google.options as Record<string, unknown>;
    const models = google.models as Record<string, unknown>;
    const existingPro = models["antigravity-gemini-3-pro"] as Record<string, unknown>;

    expect(options.clientId).toBe("custom-client-id");
    expect(options.clientSecret).toBe("custom-client-secret");
    expect(existingPro.name).toBe("Custom Gemini Pro");
    expect(Object.prototype.hasOwnProperty.call(models, "antigravity-gemini-3-flash")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "antigravity-gemini-3-pro-high")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(models, "antigravity-gemini-3-pro-low")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(existingPro, "variants")).toBe(false);
  });

  it("does not add duplicate antigravity auth plugin when package already exists", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(
        {
          plugin: ["opencode-antigravity-auth@1.2.3"],
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    const antigravityPlugins = plugin.filter(
      (item) => typeof item === "string" && item.startsWith("opencode-antigravity-auth")
    );

    expect(plugin).toContain("opencode-antigravity-auth@1.2.3");
    expect(plugin).not.toContain("opencode-antigravity-auth@latest");
    expect(antigravityPlugins.length).toBe(1);
  });

  it("does not add duplicate openai codex auth plugin when package already exists", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(
        {
          plugin: ["opencode-openai-codex-auth"],
        },
        null,
        2
      )}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    const codexPlugins = plugin.filter(
      (item) => typeof item === "string" && item.startsWith("opencode-openai-codex-auth")
    );

    expect(plugin).toContain("opencode-openai-codex-auth");
    expect(codexPlugins.length).toBe(1);
  });

  it("uses custom antigravity plugin entry when provided", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const env = {
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
      antigravityAuthPluginEntry: "opencode-antigravity-auth@9.9.9",
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    expect(plugin).toContain("opencode-antigravity-auth@9.9.9");
    expect(plugin).not.toContain("opencode-antigravity-auth@latest");
  });

  it("uses custom openai codex auth plugin entry when provided", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const env = {
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
      openAICodexAuthPluginEntry: "opencode-openai-codex-auth@8.8.8",
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    expect(plugin).toContain("opencode-openai-codex-auth@8.8.8");
    expect(plugin).not.toContain("opencode-openai-codex-auth@latest");
  });

  it("can skip auth plugins and provider catalogs via install options", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const env = {
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
      ensureAntigravityAuthPlugin: false,
      ensureOpenAICodexAuthPlugin: false,
      ensureGoogleProviderCatalog: false,
      ensureOpenAIProviderCatalog: false,
      ensureAnthropicProviderCatalog: false,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];
    const provider =
      typeof opencode.provider === "object" && opencode.provider ? (opencode.provider as Record<string, unknown>) : {};

    expect(plugin).toContain("oh-my-aegis");
    expect(plugin.some((item) => typeof item === "string" && item.startsWith("opencode-antigravity-auth"))).toBe(false);
    expect(plugin.some((item) => typeof item === "string" && item.startsWith("opencode-openai-codex-auth"))).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(provider, "google")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(provider, "openai")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(provider, "anthropic")).toBe(false);
  });

  it("resolves latest antigravity auth plugin version from npm payload", async () => {
    const entry = await resolveAntigravityAuthPluginEntry({
      fetchImpl: async () =>
        new Response(JSON.stringify({ version: "1.2.3" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(entry).toBe("opencode-antigravity-auth@1.2.3");
  });

  it("falls back to @latest when antigravity version lookup fails", async () => {
    const entry = await resolveAntigravityAuthPluginEntry({
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
    });
    expect(entry).toBe("opencode-antigravity-auth@latest");
  });

  it("resolves latest openai codex auth plugin version from npm payload", async () => {
    const entry = await resolveOpenAICodexAuthPluginEntry({
      fetchImpl: async () =>
        new Response(JSON.stringify({ version: "4.5.6" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(entry).toBe("opencode-openai-codex-auth@4.5.6");
  });

  it("falls back to @latest when openai codex auth version lookup fails", async () => {
    const entry = await resolveOpenAICodexAuthPluginEntry({
      fetchImpl: async () => {
        throw new Error("network unavailable");
      },
    });
    expect(entry).toBe("opencode-openai-codex-auth@latest");
  });
});
