type PromptAsyncCallResult = { ok: true } | { ok: false; reason: string };

type ConfigProvidersResult =
  | { ok: true; data: { providers: unknown[]; [key: string]: unknown } }
  | { ok: false; reason: string };

function getSessionPromptAsync(client: unknown): {
  session: Record<string, unknown>;
  promptAsync: (args: unknown) => Promise<unknown>;
} | null {
  const session = (client as { session?: unknown } | null)?.session;
  if (!session || typeof session !== "object") {
    return null;
  }
  const promptAsync = (session as { promptAsync?: unknown }).promptAsync;
  if (typeof promptAsync !== "function") {
    return null;
  }
  return {
    session: session as Record<string, unknown>,
    promptAsync: (promptAsync as (args: unknown) => Promise<unknown>).bind(session),
  };
}

export function hasSessionPromptAsync(client: unknown): boolean {
  return getSessionPromptAsync(client) !== null;
}

export async function callSessionPromptAsync(
  client: unknown,
  attempts: unknown[],
): Promise<PromptAsyncCallResult> {
  const prompt = getSessionPromptAsync(client);
  if (!prompt) {
    return { ok: false, reason: "client.session.promptAsync unavailable" };
  }

  let lastReason = "promptAsync failed";
  for (const args of attempts) {
    try {
      await prompt.promptAsync(args);
      return { ok: true };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }

  return { ok: false, reason: lastReason };
}

export async function callConfigProviders(client: unknown, directory: string): Promise<ConfigProvidersResult> {
  const configApi = (client as { config?: unknown } | null)?.config;
  if (!configApi || typeof configApi !== "object") {
    return { ok: false, reason: "client.config.providers unavailable" };
  }
  const providersFn = (configApi as { providers?: unknown }).providers;
  if (typeof providersFn !== "function") {
    return { ok: false, reason: "client.config.providers unavailable" };
  }

  try {
    const result = await (providersFn as (args: unknown) => Promise<unknown>).call(configApi, {
      query: { directory },
    });
    const data = (result as { data?: unknown } | null)?.data;
    if (!data || typeof data !== "object" || !Array.isArray((data as { providers?: unknown }).providers)) {
      return { ok: false, reason: "unexpected /config/providers response" };
    }
    return { ok: true, data: data as { providers: unknown[]; [key: string]: unknown } };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
