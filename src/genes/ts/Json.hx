package genes.ts;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Checked constructors for native JSON values.
 *
 * These helpers are for Haxe-owned values. They keep runtime payloads as native
 * JavaScript JSON while giving `genes-ts` a reusable type surface. Use
 * `JsonCodec.narrow` for untrusted runtime/host values instead of passing
 * `Unknown` through these constructors.
 */
class Json {
	/**
	 * Compile-time checks a Haxe expression as native JSON.
	 */
	public static macro function value(expr:Expr):ExprOf<JsonValue> {
		requireJsonExpr(expr, "Json.value");
		return macro @:pos(expr.pos) genes.ts.Json.checkedValue($expr);
	}

	/**
	 * Compile-time checks a Haxe expression as a native JSON object.
	 */
	public static macro function object(expr:Expr):ExprOf<JsonObject> {
		final typed = requireJsonExpr(expr, "Json.object");
		if (!isJsonObjectType(typed.t))
			Context.error("Json.object expects a JSON-compatible object expression", expr.pos);
		return macro @:pos(expr.pos) genes.ts.Json.checkedObject($expr);
	}

	/**
	 * Compile-time checks a Haxe expression as a native JSON array.
	 */
	public static macro function array(expr:Expr):ExprOf<JsonArray> {
		final typed = requireJsonExpr(expr, "Json.array");
		if (!isJsonArrayType(typed.t))
			Context.error("Json.array expects a JSON-compatible array expression", expr.pos);
		return macro @:pos(expr.pos) genes.ts.Json.checkedArray($expr);
	}

	#if !macro
	/**
	 * Runtime identity for expressions already accepted by `Json.value`.
	 *
	 * The macro performs the JSON-compatibility check before emitting this call.
	 * Keeping the assertion here prevents downstream generated modules from
	 * spelling raw casts while preserving native JSON runtime values.
	 */
	@:noCompletion
	public static function checkedValue<T>(value:T):JsonValue {
		return JsonCodec.unsafeAssumeJson(value);
	}

	/**
	 * Runtime identity for object expressions already accepted by `Json.object`.
	 */
	@:noCompletion
	public static function checkedObject<T>(value:T):JsonObject {
		return JsonCodec.unsafeAssumeObject(value);
	}

	/**
	 * Runtime identity for array expressions already accepted by `Json.array`.
	 */
	@:noCompletion
	public static function checkedArray<T>(value:T):JsonArray {
		return JsonCodec.unsafeAssumeArray(value);
	}

	/**
	 * Native JSON null.
	 */
	public static inline function nullValue():JsonValue {
		return JsonCodec.unsafeAssumeJson(null);
	}
	#end

	#if macro
	static function requireJsonExpr(expr:Expr, label:String):TypedExpr {
		final typed = Context.typeExpr(expr);
		if (!isJsonType(typed.t))
			Context.error(label + " expects a JSON-compatible value; use JsonCodec.narrow for Unknown/runtime boundaries", expr.pos);
		return typed;
	}

	static function isJsonType(type:Type):Bool {
		return switch Context.follow(type) {
			case TAbstract(_.get() => {
				module: "genes.ts.JsonValue" | "genes.ts.JsonObject" | "genes.ts.JsonArray" | "genes.ts.JsonPrimitive" | "genes.ts.JsonNonNullValue"
			}, _):
				true;
			case TAbstract(_.get() => {pack: [], name: "Bool" | "Int" | "Float"}, _):
				true;
			case TAbstract(_.get() => {pack: ["haxe"], name: "Int64"}, _):
				false;
			case TInst(_.get() => {pack: [], name: "String"}, _):
				true;
			case TInst(_.get() => {pack: ["js", "lib"], name: "Date" | "Symbol" | "RegExp" | "Function"}, _):
				false;
			case TInst(_.get() => {pack: [], name: "Array"}, [inner]):
				isJsonType(inner);
			case TType(_.get() => {pack: [], name: "Null"}, [inner]):
				isJsonType(inner);
			case TAnonymous(_.get() => anon):
				for (field in anon.fields) {
					if (!isJsonType(field.type))
						return false;
				}
				true;
			case TFun(_, _):
				false;
			case TMono(_):
				true;
			case TDynamic(_):
				false;
			case TAbstract(_.get() => {module: "genes.ts.Unknown" | "genes.ts.Undefinable"}, _):
				false;
			case TType(_, _):
				isJsonType(Context.follow(type));
			case _:
				false;
		}
	}

	static function isJsonObjectType(type:Type):Bool {
		return switch Context.follow(type) {
			case TAbstract(_.get() => {module: "genes.ts.JsonObject"}, _):
				true;
			case TAnonymous(_):
				true;
			case _:
				false;
		}
	}

	static function isJsonArrayType(type:Type):Bool {
		return switch Context.follow(type) {
			case TAbstract(_.get() => {module: "genes.ts.JsonArray"}, _):
				true;
			case TInst(_.get() => {pack: [], name: "Array"}, _):
				true;
			case _:
				false;
		}
	}
	#end
}
