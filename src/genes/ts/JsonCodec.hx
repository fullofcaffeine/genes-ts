package genes.ts;

import genes.Register;
import haxe.Json as HaxeJson;

typedef JsonDecodeError = {
	final message:String;
}

enum JsonDecode<T> {
	Ok(value:T);
	Error(error:JsonDecodeError);
}

/**
 * Runtime JSON parsing, validation, and stringifying helpers.
 *
 * `Unknown.fromBoundary` should keep its `unknown` contract. This codec is the
 * reusable bridge that validates arbitrary JS boundary values before returning
 * a native `JsonValue`.
 */
class JsonCodec {
	/**
	 * Parses JSON text and returns a native JSON value on success.
	 */
	public static function parse(text:String):JsonDecode<JsonValue> {
		try {
			final parsed = Unknown.fromBoundary(HaxeJson.parse(text));
			final value = narrow(parsed);
			return value == null ? Error({message: "parsed value is not JSON-compatible"}) : Ok(value);
		} catch (error:Dynamic) {
			return Error({message: Std.string(error)});
		}
	}

	/**
	 * Validates an arbitrary `Unknown` boundary value as native JSON.
	 */
	public static function narrow(value:Unknown):Null<JsonValue> {
		return isJsonValue(value) ? unsafeAssumeJson(value) : null;
	}

	public static function narrowObject(value:Unknown):Null<JsonObject> {
		return isJsonObject(value) ? unsafeAssumeJson(value) : null;
	}

	public static function narrowArray(value:Unknown):Null<JsonArray> {
		return isJsonArray(value) ? unsafeAssumeJson(value) : null;
	}

	public static function stringify(value:JsonValue):String {
		return HaxeJson.stringify(value);
	}

	@:noCompletion
	public static inline function unsafeAssumeJson<T>(value:T):JsonValue {
		// Contained assertion for values already proven by Json macros, JSON.parse,
		// or the runtime guards below. Product code should not call this directly.
		return Register.unsafeCast(value);
	}

	@:noCompletion
	public static inline function unsafeAssumeObject<T>(value:T):JsonObject {
		// Contained assertion for values already proven by Json.object or guards.
		return Register.unsafeCast(value);
	}

	@:noCompletion
	public static inline function unsafeAssumeArray<T>(value:T):JsonArray {
		// Contained assertion for values already proven by Json.array or guards.
		return Register.unsafeCast(value);
	}

	static function isJsonArray(value:Unknown):Bool {
		if (!js.Syntax.code("Array.isArray({0})", value))
			return false;
		final array:UnknownArray = Register.unsafeCast(value);
		for (index in 0...array.length) {
			if (!isJsonValue(array.get(index)))
				return false;
		}
		return true;
	}

	static function isJsonObject(value:Unknown):Bool {
		if (js.Syntax.code("({0}) === null || typeof ({0}) !== \"object\" || Array.isArray({0})", value))
			return false;
		return js.Syntax.code("Object.getPrototypeOf({0}) === Object.prototype || Object.getPrototypeOf({0}) === null", value);
	}

	static function isJsonValue(value:Unknown):Bool {
		if (js.Syntax.code("({0}) === null", value))
			return true;
		final kind:String = js.Syntax.code("typeof ({0})", value);
		if (kind == "string" || kind == "boolean")
			return true;
		if (kind == "number")
			return js.Syntax.code("Number.isFinite({0})", value);
		if (isJsonArray(value))
			return true;
		if (!isJsonObject(value))
			return false;
		final object:UnknownRecord = Register.unsafeCast(value);
		for (key in object.keys()) {
			if (!isJsonValue(object.get(key)))
				return false;
		}
		return true;
	}
}
