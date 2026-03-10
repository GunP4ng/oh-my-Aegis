export const appendUniqueRef = (refs: string[], value: string): string[] => {
  const normalized = value.trim();
  if (!normalized || refs.includes(normalized)) {
    return refs;
  }
  return [...refs, normalized];
};
