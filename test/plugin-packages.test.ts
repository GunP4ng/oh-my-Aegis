import { describe, expect, it } from "bun:test";
import { collectPluginPackageSpecs } from "../src/install/plugin-packages";

describe("plugin package sync", () => {
  it("keeps npm package specs and skips local plugin paths", () => {
    const specs = collectPluginPackageSpecs([
      "opencode-gemini-auth@1.4.8",
      "/tmp/opencode-claude-auth/dist/index.js",
      "./relative-plugin.js",
      "opencode-claude-auth@1.0.1",
      "opencode-gemini-auth@1.4.8",
    ]);

    expect(specs).toEqual(["opencode-gemini-auth@1.4.8", "opencode-claude-auth@1.0.1"]);
  });
});
