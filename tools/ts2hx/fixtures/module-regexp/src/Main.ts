const INVALID_ATTRIBUTE_NAME: RegExp = /[<>]/;

function assertEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

export function escapeMarkup(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

export function isValidAttributeName(value: string): boolean {
  return !INVALID_ATTRIBUTE_NAME.test(value);
}

export function main(): void {
  assertEqual(escapeMarkup("A & <B>"), "A &amp; &lt;B>", "replace");
  if (!isValidAttributeName("data-id")) throw new Error("valid attribute rejected");
  if (isValidAttributeName("bad<name")) throw new Error("invalid attribute accepted");
  console.log("MODULE_REGEXP_OK");
}
