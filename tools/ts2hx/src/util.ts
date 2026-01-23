export function toHaxePackagePath(pathSegments: readonly string[]): string {
  const parts = pathSegments
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.join(".");
}

function isAlphaNumeric(ch: string): boolean {
  return /^[a-z0-9]$/i.test(ch);
}

export function toHaxeModuleName(fileBase: string): string {
  const cleaned = fileBase.trim();
  const words: string[] = [];
  let current = "";

  for (const ch of cleaned) {
    if (isAlphaNumeric(ch)) {
      current += ch;
    } else if (current.length > 0) {
      words.push(current);
      current = "";
    }
  }

  if (current.length > 0) words.push(current);

  if (words.length === 0) return "Module";

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("")
    .replace(/^[0-9]+/, "");
}

