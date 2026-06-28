package genes.ts;

/**
 * Native JSON scalar value.
 *
 * The runtime representation is unchanged JavaScript JSON: null, booleans,
 * finite numbers, and strings. Rich recursive aliases are a TypeScript source
 * target contract; classic Genes output erases this helper to the native value.
 */
@:ts.type("null | boolean | number | string")
abstract JsonPrimitive(Dynamic) to Dynamic {}
