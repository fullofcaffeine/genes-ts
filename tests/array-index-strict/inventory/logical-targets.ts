/**
 * TypeScript capability probe for the raw logical targets retained by Genes.
 *
 * These functions are never executed. The supported TypeScript lanes compile
 * them with `noUncheckedIndexedAccess` so the indexed plan does not assume that
 * a target checker accepts nullable, undefined-aware, or unknown writable
 * slots. Adding postfix `!` would deliberately make the nullable right-hand
 * sides fail.
 */
export function nullableLogicalAssignments(
  values: Array<boolean | null>,
  fallback: boolean | null
): void {
  values[0] ??= fallback;
  values[0] ||= fallback;
  values[0] &&= fallback;
}

export function undefinedLogicalAssignments(
  values: Array<boolean | undefined>,
  fallback: boolean | undefined
): void {
  values[0] ??= fallback;
  values[0] ||= fallback;
  values[0] &&= fallback;
}

export function unknownLogicalAssignments(
  values: unknown[],
  fallback: unknown
): void {
  values[0] ??= fallback;
  values[0] ||= fallback;
  values[0] &&= fallback;
}
