package module_functions;

import module_functions.NullInference.Missing;

/** A precise host-style field whose emitted TypeScript type is overridden. */
typedef OverriddenAssignmentBox = {
  @:ts.type("string | number")
  var value: String;
}

/**
 * Proves a TypeScript-only assertion retains its compiler runtime dependency.
 *
 * Haxe accepts a nullable numeric relation with JavaScript coercion semantics.
 * Strict TypeScript needs Genes to emit `Register.unsafeCast<number>` around
 * the nullable operand. This direct-only module therefore imports Register in
 * TypeScript profiles even though classic JavaScript needs no helper and no
 * synthetic module-fields owner survives.
 */
@:genes.moduleFunction("positive")
function positive(value: Null<Int>): Bool {
  return value > 0;
}

/**
 * Proves a planned return bridge retains Register before imports are frozen.
 *
 * Haxe accepts the nullable source in this non-null destination outside a
 * null-safe package. Genes' TypeScript boundary plan records the exact identity
 * assertion; the dependency plan must consume that fact instead of attempting
 * to rediscover only selected emitter syntax.
 */
@:genes.moduleFunction("forceReturn")
function forceReturn(value: Null<String>): String {
  return value;
}

/**
 * Proves an assignment to an overridden field retains its identity helper.
 *
 * The Haxe field remains `String`, while the public TypeScript boundary admits
 * a host-compatible string-or-number value. Genes therefore asserts the
 * assignment result to that authored target type without changing runtime
 * behavior.
 */
@:genes.moduleFunction("assignOverride")
function assignOverride(target: OverriddenAssignmentBox,
    value: String): String {
  target.value = value;
  return value;
}

/**
 * Proves enum `null` inference retains Register in a direct-only TS module.
 *
 * TypeScript would otherwise infer the generic payload from literal `null`.
 * The runtime value stays plain `null`; the identity assertion affects only
 * TypeScript's inference.
 */
@:genes.moduleFunction("missingValue")
function missingValue(): NullInference<Null<String>> {
  return Missing(null);
}
