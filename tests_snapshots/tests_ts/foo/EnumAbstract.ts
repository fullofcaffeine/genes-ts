import {Register} from "../genes/Register.js"

export class EnumAbstract {
	static accepts(v: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload"): "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" {
		return v;
	}
	static demo(): "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" {
		return EnumAbstract.accepts("default");
	}
	static get __name__(): string {
		return "foo.EnumAbstract"
	}
	get __class__(): Function {
		return EnumAbstract
	}
}
Register.setHxClass("foo.EnumAbstract", EnumAbstract);
