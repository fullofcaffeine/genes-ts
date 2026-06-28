package genes.ts;

/**
 * Native JSON object with recursive JSON-compatible property values.
 */
@:ts.type("{ readonly [key: string]: JsonValue }")
abstract JsonObject(Dynamic) to Dynamic {}
