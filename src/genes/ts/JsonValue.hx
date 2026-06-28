package genes.ts;

/**
 * Native JavaScript JSON value.
 *
 * This is not a tagged AST like `tink.json.Value`: values stay as native JSON
 * payloads because downstream runtimes store and pass ordinary objects, arrays,
 * strings, numbers, booleans, and null. Use `Json.value/object/array` for
 * Haxe-owned values and `JsonCodec.narrow` for untrusted `Unknown` boundaries.
 */
@:ts.type("JsonPrimitive | JsonObject | JsonArray")
abstract JsonValue(Dynamic) from JsonPrimitive from JsonObject from JsonArray to Dynamic {}
