import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyAegisConfig,
  resolveAntigravityAuthPluginEntry,
  resolveOpenAICodexAuthPluginEntry,
  resolveOpencodeDir,
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
    const modelCli =
      typeof (provider as Record<string, unknown>).model_cli === "object" && (provider as Record<string, unknown>).model_cli
        ? ((provider as Record<string, unknown>).model_cli as Record<string, unknown>)
        : {};
    const openaiModels =
      typeof openai.models === "object" && openai.models ? (openai.models as Record<string, unknown>) : {};
    const anthropicModels =
      typeof anthropic.models === "object" && anthropic.models ? (anthropic.models as Record<string, unknown>) : {};
    const modelCliModels =
      typeof modelCli.models === "object" && modelCli.models ? (modelCli.models as Record<string, unknown>) : {};
    const openaiOptions =
      typeof openai.options === "object" && openai.options ? (openai.options as Record<string, unknown>) : {};
    const modelCliOptions =
      typeof modelCli.options === "object" && modelCli.options ? (modelCli.options as Record<string, unknown>) : {};

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
    expect(modelCli.name).toBe("Model CLI");
    expect(modelCli.npm).toBe("@ai-sdk/openai-compatible");
    expect(modelCliOptions.baseURL).toBe("http://127.0.0.1");
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-3.1-pro")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-3-flash")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-2.5-pro")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-2.5-flash")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-2.5-flash-lite")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-sonnet-4.6")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-opus-4.6")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-haiku-4.5")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-sonnet-4.5")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-opus-4.1")).toBe(true);
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
    const parallel = aegis.parallel as Record<string, unknown>;
    expect(parallel.auto_dispatch_scan).toBe(true);
    expect(parallel.auto_dispatch_hypothesis).toBe(true);
    const patchBoundary = aegis.patch_boundary as Record<string, unknown>;
    const reviewGate = aegis.review_gate as Record<string, unknown>;
    const council = aegis.council as Record<string, unknown>;
    const applyLock = aegis.apply_lock as Record<string, unknown>;
    expect(patchBoundary.enabled).toBe(true);
    expect(patchBoundary.fail_closed).toBe(true);
    expect(reviewGate.enabled).toBe(true);
    expect(reviewGate.fail_closed).toBe(true);
    expect(council.enabled).toBe(true);
    expect(council.fail_closed).toBe(true);
    expect(applyLock.enabled).toBe(true);
    expect(applyLock.fail_closed).toBe(true);
    expect(result.backupPath).toBeNull();
  });

  it("reuses existing installed path under OPENCODE_CONFIG_DIR instead of default opencode dir", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg-default");
    const overrideRoot = join(root, "opencode-aegis");
    const overrideOpencodeDir = join(overrideRoot, "opencode");
    const defaultOpencodeDir = join(xdg, "opencode");

    mkdirSync(overrideOpencodeDir, { recursive: true });
    mkdirSync(defaultOpencodeDir, { recursive: true });

    writeFileSync(
      join(overrideOpencodeDir, "opencode.json"),
      `${JSON.stringify({ plugin: ["oh-my-aegis@0.1.0"] }, null, 2)}\n`,
      "utf-8"
    );
    writeFileSync(
      join(defaultOpencodeDir, "opencode.json"),
      `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`,
      "utf-8"
    );

    const env = {
      XDG_CONFIG_HOME: xdg,
      OPENCODE_CONFIG_DIR: overrideRoot,
      HOME: join(root, "home"),
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
      backupExistingConfig: false,
    });

    expect(result.opencodePath.startsWith(overrideOpencodeDir)).toBe(true);

    const defaultOpencode = readJson(join(defaultOpencodeDir, "opencode.json"));
    const defaultPlugins = Array.isArray(defaultOpencode.plugin) ? defaultOpencode.plugin : [];
    expect(defaultPlugins).toEqual(["existing-plugin"]);
  });

  it("treats OPENCODE_CONFIG_DIR ending with opencode as the config directory", () => {
    const root = makeRoot();
    const overrideOpencodeDir = join(root, "profiles", "active", "opencode");
    mkdirSync(overrideOpencodeDir, { recursive: true });
    writeFileSync(
      join(overrideOpencodeDir, "opencode.json"),
      `${JSON.stringify({ plugin: ["existing-plugin"] }, null, 2)}\n`,
      "utf-8"
    );

    const env = {
      OPENCODE_CONFIG_DIR: overrideOpencodeDir,
    } as NodeJS.ProcessEnv;

    const resolved = resolveOpencodeDir(env);
    expect(resolved).toBe(overrideOpencodeDir);

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
      backupExistingConfig: false,
    });

    expect(result.opencodePath).toBe(join(overrideOpencodeDir, "opencode.json"));
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
    expect(ctfWeb?.model).toBe("openai/gpt-5.3-codex");
  });

  it("uses configured dynamic_model role profiles when seeding required agents", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify(
        {
          dynamic_model: {
            role_profiles: {
              execution: { model: "openai/gpt-5.2", variant: "low" },
              planning: { model: "model_cli/claude-opus-4.1", variant: "max" },
              exploration: { model: "model_cli/gemini-2.5-pro", variant: "" },
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
    const agent = typeof opencode.agent === "object" && opencode.agent ? (opencode.agent as Record<string, unknown>) : {};
    const ctfWeb = agent["ctf-web"] as Record<string, unknown> | undefined;

    expect(typeof ctfWeb).toBe("object");
    expect(ctfWeb?.model).toBe("openai/gpt-5.2");
    expect(ctfWeb?.variant).toBe("low");
  });

  it("fills dynamic_model defaults when legacy config has an empty dynamic_model object", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify({ dynamic_model: {} }, null, 2)}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const aegis = readJson(result.aegisPath);
    const dynamicModel = aegis.dynamic_model as Record<string, unknown>;
    const roleProfiles = dynamicModel.role_profiles as Record<string, unknown>;
    const execution = roleProfiles.execution as Record<string, unknown>;
    const planning = roleProfiles.planning as Record<string, unknown>;
    const exploration = roleProfiles.exploration as Record<string, unknown>;

    expect(dynamicModel.enabled).toBe(true);
    expect(execution.model).toBe("openai/gpt-5.3-codex");
    expect(execution.variant).toBe("high");
    expect(planning.model).toBe("model_cli/claude-sonnet-4.6");
    expect(planning.variant).toBe("low");
    expect(exploration.model).toBe("model_cli/gemini-3.1-pro");
    expect(exploration.variant).toBe("");
  });

  it("merges partial dynamic_model role_profiles without wiping other lanes", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify(
        {
          dynamic_model: {
            role_profiles: {
              planning: { model: "model_cli/claude-opus-4.6", variant: "max" },
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

    const aegis = readJson(result.aegisPath);
    const roleProfiles = (aegis.dynamic_model as Record<string, unknown>).role_profiles as Record<string, unknown>;
    const execution = roleProfiles.execution as Record<string, unknown>;
    const planning = roleProfiles.planning as Record<string, unknown>;
    const exploration = roleProfiles.exploration as Record<string, unknown>;

    expect(execution.model).toBe("openai/gpt-5.3-codex");
    expect(execution.variant).toBe("high");
    expect(planning.model).toBe("model_cli/claude-opus-4.6");
    expect(planning.variant).toBe("max");
    expect(exploration.model).toBe("model_cli/gemini-3.1-pro");
    expect(exploration.variant).toBe("");
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

  it("fills new parallel auto-dispatch keys as enabled when existing parallel config is legacy", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "oh-my-Aegis.json"),
      `${JSON.stringify(
        {
          parallel: {
            queue_enabled: true,
            max_concurrent_per_provider: 2,
            provider_caps: {},
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

    const aegis = readJson(result.aegisPath);
    const parallel = aegis.parallel as Record<string, unknown>;
    expect(parallel.queue_enabled).toBe(true);
    expect(parallel.auto_dispatch_scan).toBe(true);
    expect(parallel.auto_dispatch_hypothesis).toBe(true);
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
      ensureGeminiCliProviderCatalog: false,
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
    expect(Object.prototype.hasOwnProperty.call(provider, "model_cli")).toBe(false);
  });

  it("can explicitly enable gemini cli provider catalog", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const env = {
      XDG_CONFIG_HOME: xdg,
      HOME: join(root, "home"),
    } as NodeJS.ProcessEnv;

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis",
      environment: env,
      ensureGoogleProviderCatalog: false,
      ensureOpenAIProviderCatalog: false,
      ensureAnthropicProviderCatalog: false,
      ensureGeminiCliProviderCatalog: true,
    });

    const opencode = readJson(result.opencodePath);
    const provider =
      typeof opencode.provider === "object" && opencode.provider ? (opencode.provider as Record<string, unknown>) : {};
    const modelCli =
      typeof provider.model_cli === "object" && provider.model_cli
        ? (provider.model_cli as Record<string, unknown>)
        : {};
    const models =
      typeof modelCli.models === "object" && modelCli.models ? (modelCli.models as Record<string, unknown>) : {};

    expect(Object.prototype.hasOwnProperty.call(provider, "google")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(provider, "openai")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(provider, "anthropic")).toBe(false);
    expect(modelCli.name).toBe("Model CLI");
    expect(modelCli.npm).toBe("@ai-sdk/openai-compatible");
    expect(Object.prototype.hasOwnProperty.call(models, "gemini-3.1-pro")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "gemini-3-flash")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "gemini-2.5-pro")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "gemini-2.5-flash")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "gemini-2.5-flash-lite")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "claude-sonnet-4.6")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "claude-opus-4.6")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "claude-haiku-4.5")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "claude-sonnet-4.5")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(models, "claude-opus-4.1")).toBe(true);
  });

  it("migrates legacy gemini_cli provider catalog into model_cli", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(
        {
          provider: {
            gemini_cli: {
              name: "Legacy Gemini CLI",
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: "http://127.0.0.2",
              },
              models: {
                "gemini-2.5-pro": {
                  name: "Custom Gemini 2.5 Pro",
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
    const legacyGeminiCli = provider.gemini_cli as Record<string, unknown>;
    const modelCli = provider.model_cli as Record<string, unknown>;
    const modelCliOptions = modelCli.options as Record<string, unknown>;
    const modelCliModels = modelCli.models as Record<string, unknown>;
    const migratedProModel = modelCliModels["gemini-2.5-pro"] as Record<string, unknown>;

    expect(legacyGeminiCli.name).toBe("Legacy Gemini CLI");
    expect(modelCli.name).toBe("Legacy Gemini CLI");
    expect(modelCli.npm).toBe("@ai-sdk/openai-compatible");
    expect(modelCliOptions.baseURL).toBe("http://127.0.0.2");
    expect(migratedProModel.name).toBe("Custom Gemini 2.5 Pro");
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-3.1-pro")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-3-flash")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-2.5-flash")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "gemini-2.5-flash-lite")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-sonnet-4.6")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-opus-4.6")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-haiku-4.5")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-sonnet-4.5")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(modelCliModels, "claude-opus-4.1")).toBe(true);
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

  it("replaces existing versioned oh-my-aegis entry when installing a newer version", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify({ plugin: ["other-plugin", "oh-my-aegis@0.1.1"] }, null, 2)}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis@0.1.26",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];

    // New version entry is present
    expect(plugin).toContain("oh-my-aegis@0.1.26");
    // Old version entry is gone
    expect(plugin).not.toContain("oh-my-aegis@0.1.1");
    // Other plugins are preserved
    expect(plugin).toContain("other-plugin");
    // No duplicate oh-my-aegis entries
    const aegisEntries = plugin.filter(
      (item) => typeof item === "string" && (item === "oh-my-aegis" || (item as string).startsWith("oh-my-aegis@"))
    );
    expect(aegisEntries.length).toBe(1);
  });

  it("replaces an absolute-path plugin entry with the new npm package reference", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    const absoluteEntry = "/home/user/project/oh-my-Aegis/dist/index.js";
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify({ plugin: ["other-plugin", absoluteEntry] }, null, 2)}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis@0.1.26",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];

    // New npm reference is present
    expect(plugin).toContain("oh-my-aegis@0.1.26");
    // Old absolute path is removed
    expect(plugin).not.toContain(absoluteEntry);
    // Other plugins are preserved
    expect(plugin).toContain("other-plugin");
  });

  it("removes duplicate oh-my-aegis stale entries and keeps only the new one", () => {
    const root = makeRoot();
    const xdg = join(root, "xdg");
    const opencodeDir = join(xdg, "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    writeFileSync(
      join(opencodeDir, "opencode.json"),
      `${JSON.stringify(
        { plugin: ["oh-my-aegis@0.1.0", "other-plugin", "oh-my-aegis@0.1.1"] },
        null,
        2
      )}\n`,
      "utf-8"
    );

    const result = applyAegisConfig({
      pluginEntry: "oh-my-aegis@0.1.26",
      environment: { XDG_CONFIG_HOME: xdg } as NodeJS.ProcessEnv,
      backupExistingConfig: false,
    });

    const opencode = readJson(result.opencodePath);
    const plugin = Array.isArray(opencode.plugin) ? opencode.plugin : [];

    expect(plugin).toContain("oh-my-aegis@0.1.26");
    expect(plugin).not.toContain("oh-my-aegis@0.1.0");
    expect(plugin).not.toContain("oh-my-aegis@0.1.1");
    expect(plugin).toContain("other-plugin");
    const aegisEntries = plugin.filter(
      (item) => typeof item === "string" && (item as string).startsWith("oh-my-aegis")
    );
    expect(aegisEntries.length).toBe(1);
  });
});
