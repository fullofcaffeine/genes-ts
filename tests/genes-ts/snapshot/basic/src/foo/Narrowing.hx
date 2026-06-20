package foo;

typedef NarrowedPayload = {
	final value:String;
};

class Narrowing {
	/**
		Why: Haxe can narrow a nullable switch subject by giving the `null` case an
		exiting branch. genes-ts should preserve that flow fact in generated
		TypeScript instead of inserting an identity `Register.unsafeCast`.

		What/How: the non-null `case payload` branch becomes the initializer for a
		non-null local. The snapshot protects the IIFE-based switch-expression
		emission path, which needs expected-type context just like `if`
		expressions, returns, object fields, and ordinary local initializers.
	**/
	public static function switchExitingNull(input:Null<NarrowedPayload>):String {
		final payload:NarrowedPayload = switch input {
			case null:
				return "missing";
			case payload:
				payload;
		};
		return payload.value;
	}
}
