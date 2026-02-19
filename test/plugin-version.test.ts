import { describe, expect, it } from "bun:test";
import { fetchNpmDistTags, resolvePluginEntryWithVersion } from "../src/install/plugin-version";

describe("plugin version resolver", () => {
  it("extracts npm dist-tags map", async () => {
    const tags = await fetchNpmDistTags("oh-my-aegis", {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            "dist-tags": {
              latest: "1.2.3",
              beta: "1.3.0-beta.1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
    });

    expect(tags).not.toBeNull();
    expect(tags?.latest).toBe("1.2.3");
    expect(tags?.beta).toBe("1.3.0-beta.1");
  });

  it("uses latest dist-tag when current version matches latest", async () => {
    const entry = await resolvePluginEntryWithVersion("oh-my-aegis", "1.2.3", {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            "dist-tags": {
              latest: "1.2.3",
              beta: "1.3.0-beta.1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
    });

    expect(entry).toBe("oh-my-aegis@latest");
  });

  it("uses beta dist-tag when current version matches beta", async () => {
    const entry = await resolvePluginEntryWithVersion("oh-my-aegis", "1.3.0-beta.1", {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            "dist-tags": {
              latest: "1.2.3",
              beta: "1.3.0-beta.1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        ),
    });

    expect(entry).toBe("oh-my-aegis@beta");
  });

  it("falls back to explicit version when dist-tags cannot be resolved", async () => {
    const entry = await resolvePluginEntryWithVersion("oh-my-aegis", "1.2.3", {
      fetchImpl: async () => {
        throw new Error("network error");
      },
    });

    expect(entry).toBe("oh-my-aegis@1.2.3");
  });
});
