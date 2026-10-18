/** The name in a From header. A bare address is not a name. */
export function displayNameFromHeader(from: string | undefined): string | undefined {
  if (!from) return undefined;
  const trimmed = from.trim();
  const angle = trimmed.indexOf("<");
  const name = (angle === -1 ? trimmed : trimmed.slice(0, angle)).replace(/"/g, "").trim();
  if (!name || name.includes("@")) return undefined;
  return name;
}
