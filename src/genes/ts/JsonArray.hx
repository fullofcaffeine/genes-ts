package genes.ts;

/**
 * Native JSON array with recursive JSON-compatible element values.
 */
@:ts.type("readonly JsonValue[]")
abstract JsonArray(Array<JsonValue>) to Array<JsonValue> {}
