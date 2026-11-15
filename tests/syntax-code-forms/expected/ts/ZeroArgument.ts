import {Std} from "../Std.js"
import {Register} from "../genes/Register.js"

/**
 * `js.Syntax.code` calls that have a literal template and no value argument.
 *
 * Why: this is the form that Genes used to hand to Haxe's own printer. Each
 * line below is one shape of that form. `yarn test:syntax-code-forms` compares
 * the emitted module with the text that Haxe's printer produced before Genes
 * printed these calls itself.
 *
 * The values are typed at once, so no `Dynamic` value leaves a raw template.
 */
export class ZeroArgument extends Register.inherits() {
	constructor() {
		super();
	}
	declare label: string;
	[Register.new](...args: never[]): void;
	[Register.new](): void {
		this.label = "instance";
	}

	/**
	 * The template `this` must print the JavaScript receiver.
	 */
	receiver(): ZeroArgument {
		return this;
	}
	static run(): string[] {
		const out: string[] = [];
		Reflect.set(globalThis, '__syntaxCodeForms', []);
		Reflect.get(globalThis, '__syntaxCodeForms').push('statement');
		const max: number = Math.max(1, 2);
		out.push((max == null) ? "null" : "" + max);
		const min: number = Math.min(1, 2);
		out.push((min == null) ? "null" : "" + min);
		const doubled: string = JSON.stringify([{a: 1}, {}, {}]);
		out.push(doubled);
		const named: string = JSON.stringify(((x) => ({x}))(7));
		out.push(named);
		const braces: string = '{{x}} {} }{ {0} { 0 } {1e3} {0x} {_1} {a}}';
		out.push(braces);
		const multiline: string = (function () {
      // a comment stays
      return 'multiline';
    })();
		out.push(multiline);
		const length: number = ('four'!).length;
		out.push((length == null) ? "null" : "" + length);
		const parsed: number = (parseInt)("12");
		out.push((parsed == null) ? "null" : "" + parsed);
		const pushed: number = Reflect.get(globalThis, '__syntaxCodeForms').length;
		out.push((pushed == null) ? "null" : "" + pushed);
		const instance: ZeroArgument = new ZeroArgument();
		out.push(Std.string(instance.receiver() == instance));
		out.push(instance.receiver().label);
		return out;
	}
	static get __name__(): string {
		return "syntaxcodeforms.ZeroArgument"
	}
	get __class__(): Function {
		return ZeroArgument
	}
}
Register.setHxClass("syntaxcodeforms.ZeroArgument", ZeroArgument);

Register.seedProtoField(ZeroArgument, "label");

//# sourceMappingURL=ZeroArgument.ts.map
