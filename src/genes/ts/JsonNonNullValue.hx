package genes.ts;

/**
 * Native JSON value excluding null.
 */
@:ts.type("Exclude<JsonValue, null>")
abstract JsonNonNullValue(JsonValue) to JsonValue {}
