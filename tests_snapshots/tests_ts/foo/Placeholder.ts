import {Register} from "../genes/Register.js"

export class Placeholder {
	static demo(): ReadonlyArray<number> {
		return [1, 2, 3];
	}
	static get __name__(): string {
		return "foo.Placeholder"
	}
	get __class__(): Function {
		return Placeholder
	}
}
Register.setHxClass("foo.Placeholder", Placeholder);
