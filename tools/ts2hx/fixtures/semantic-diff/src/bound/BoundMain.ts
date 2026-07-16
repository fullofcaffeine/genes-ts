import { unused as unusedValue } from "./unused.js";
import unusedDefaultValue from "./unusedDefaultEffect.js";
import * as unusedNamespace from "./unusedNamespaceEffect.js";
import defaultValue from "./defaultEffect.js";
import * as namespaceEffect from "./namespaceEffect.js";
import {} from "./emptyEffect.js";
import { type InlineMarker } from "./inlineTypeEffect.js";
import type { DeclarationMarker } from "./declarationTypeEffect.js";
import { mixedValue, type MixedMarker } from "./mixedEffect.js";
import defaultEmptyValue, {} from "./defaultEmptyEffect.js";
import defaultNamedValue, { namedValue } from "./defaultNamedEffect.js";
import defaultNamespaceValue, * as defaultNamespaceEffect from "./defaultNamespaceEffect.js";
import { first as firstValue } from "./first.js";
import { second as secondValue } from "./second.js";
import { events } from "./state.js";
import { first as firstAgain } from "./first.js";

/**
 * Prints the standalone bound-request proof.
 *
 * The first three bindings deliberately have no value read, so TypeScript
 * retains their requests only with verbatim module syntax. Empty and inline
 * type-only clauses exercise target-marker requests, while declaration-wide
 * `import type` must never initialize its target. Combined default/empty,
 * default/named, and default/namespace clauses cover every retained ESM import
 * shape. The First bindings are read in reverse order and repeated to prove
 * source ordering plus once-only module evaluation.
 */
export function main(): void {
  const inlineMarker: InlineMarker | null = null;
  const declarationMarker: DeclarationMarker | null = null;
  const mixedMarker: MixedMarker | null = null;
  if (inlineMarker || declarationMarker || mixedMarker) throw new Error("unreachable type marker");
  console.log(
    `BOUND_TRACE:${events.join(",")}|${defaultValue}:${namespaceEffect.namespaceValue}:${mixedValue}:${defaultEmptyValue}:${defaultNamedValue}:${namedValue}:${defaultNamespaceValue}:${defaultNamespaceEffect.namespaceValue}:${secondValue}:${firstValue}:${firstAgain}`
  );
}
