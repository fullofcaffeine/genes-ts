import {Register} from "../genes/Register.js"

export type NarrowedPayload = {
	value: string
}

export class Narrowing {

	/**
	Why: Haxe can narrow a nullable switch subject by giving the `null` case an
	exiting branch. genes-ts should preserve that flow fact in generated
	TypeScript instead of inserting an identity `Register.unsafeCast`.

	What/How: the non-null `case payload` branch becomes the initializer for a
	non-null local. The snapshot protects the IIFE-based switch-expression
	emission path, which needs expected-type context just like `if`
	expressions, returns, object fields, and ordinary local initializers.
	*/
	static switchExitingNull(input: NarrowedPayload | null): string {
		let payload: NarrowedPayload;
		if (input == null) {
			return "missing";
		} else {
			let payload1: NarrowedPayload = input;
			payload = payload1;
		};
		return payload.value;
	}
	static get __name__(): string {
		return "foo.Narrowing"
	}
	get __class__(): Function {
		return Narrowing
	}
}
Register.setHxClass("foo.Narrowing", Narrowing);
