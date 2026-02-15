export type ParsedModelId = { providerID: string; modelID: string };

export function parseModelId(model: string): ParsedModelId {
  const trimmed = String(model ?? "").trim();
  const idx = trimmed.indexOf("/");
  if (idx <= 0 || idx === trimmed.length - 1) {
    return { providerID: "unknown", modelID: trimmed };
  }
  return {
    providerID: trimmed.slice(0, idx),
    modelID: trimmed.slice(idx + 1),
  };
}
