package tests.generationcaches;

import genes.ts.JsonValue;

/**
 * Two typedefs that name each other; only `JsonCycleInner` reaches a JSON
 * helper directly.
 *
 * `GenerationCachesProbe` types this module after generation, so it is not
 * part of the test program and emits nothing. A search that starts at
 * `JsonCycleInner` reads its result type `JsonCycleOuter` first (a function
 * type is searched result first). Inside that search `JsonCycleInner` is on
 * the search path, so `JsonCycleOuter` gets a "no" that is not complete.
 * Kept for the generation, that "no" would be the wrong answer for a later
 * search of `JsonCycleOuter`, which really reaches `JsonValue`.
 */
typedef JsonCycleOuter = {
  final inner: JsonCycleInner;
}

typedef JsonCycleInner = (value: JsonValue) -> JsonCycleOuter;
