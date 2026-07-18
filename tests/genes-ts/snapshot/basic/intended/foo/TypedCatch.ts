import {Exception} from "../haxe/Exception.js"
import {Register} from "../genes/Register.js"

export class FixtureError extends Register.inherits() {
	constructor(message: string) {
		super(message);
	}
	declare message: string;
	[Register.new](...args: never[]): void;
	[Register.new](message: string): void {
		this.message = message;
	}
	toString(): string {
		return this.message;
	}
	static get __name__(): string {
		return "foo.FixtureError"
	}
	get __class__(): Function {
		return FixtureError
	}
}
Register.setHxClass("foo.FixtureError", FixtureError);

Register.seedProtoField(FixtureError, "message");

export class TypedCatch {

	/**
	Why: Haxe lowers `catch (error:FixtureError)` through
	`haxe.Exception.caught(raw).unwrap()` and a runtime type guard. genes-ts
	must not expose the lowered dynamic temporary as a weak user-module type.

	What/How: this fixture catches a user-defined class, reads a typed field,
	and has a fallback catch so the generated TS must preserve both Haxe's
	runtime matching semantics and strict user-module typing.
	*/
	static recover(kind: string): string {
		try {
			if (kind == "fixture") {
				throw Exception.thrown(new FixtureError("typed"));
			};
			throw Exception.thrown("plain");
		}catch (_g) {
			let _g1: {} | null | undefined = Exception.caught(_g).unwrap();
			if (((_g1) instanceof FixtureError)) {
				let error: FixtureError = _g1;
				return error.message;
			} else {
				return "fallback";
			};
		};
	}
	static get __name__(): string {
		return "foo.TypedCatch"
	}
	get __class__(): Function {
		return TypedCatch
	}
}
Register.setHxClass("foo.TypedCatch", TypedCatch);
