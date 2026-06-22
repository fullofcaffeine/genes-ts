package foo;

class FixtureError {
	public final message:String;

	public function new(message:String) {
		this.message = message;
	}

	public function toString():String {
		return message;
	}
}

class TypedCatch {
	/**
		Why: Haxe lowers `catch (error:FixtureError)` through
		`haxe.Exception.caught(raw).unwrap()` and a runtime type guard. genes-ts
		must not expose the lowered dynamic temporary as a weak user-module type.

		What/How: this fixture catches a user-defined class, reads a typed field,
		and has a fallback catch so the generated TS must preserve both Haxe's
		runtime matching semantics and strict user-module typing.
	**/
	public static function recover(kind:String):String {
		try {
			if (kind == "fixture")
				throw new FixtureError("typed");
			throw "plain";
		} catch (error:FixtureError) {
			return error.message;
		} catch (_:haxe.Exception) {
			return "fallback";
		}
	}
}
