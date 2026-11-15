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
export const ZeroArgument = Register.hxClasses()["syntaxcodeforms.ZeroArgument"] =
class ZeroArgument extends Register.inherits() {
	[Register.new]() {
		this.label = "instance";
	}

	/**
	 * The template `this` must print the JavaScript receiver.
	 */
	receiver() {
		return this;
	}
	static run() {
		const out = [];
		Reflect.set(globalThis, '__syntaxCodeForms', []);
		Reflect.get(globalThis, '__syntaxCodeForms').push('statement');
		const max = Math.max(1, 2);
		out.push((max == null) ? "null" : "" + max);
		const min = Math.min(1, 2);
		out.push((min == null) ? "null" : "" + min);
		const doubled = JSON.stringify([{a: 1}, {}, {}]);
		out.push(doubled);
		const named = JSON.stringify(((x) => ({x}))(7));
		out.push(named);
		const braces = '{{x}} {} }{ {0} { 0 } {1e3} {0x} {_1} {a}}';
		out.push(braces);
		const multiline = (function () {
      // a comment stays
      return 'multiline';
    })();
		out.push(multiline);
		const length = 'four'.length;
		out.push((length == null) ? "null" : "" + length);
		const parsed = (parseInt)("12");
		out.push((parsed == null) ? "null" : "" + parsed);
		const pushed = Reflect.get(globalThis, '__syntaxCodeForms').length;
		out.push((pushed == null) ? "null" : "" + pushed);
		const instance = new ZeroArgument();
		out.push(Std.string(instance.receiver() == instance));
		out.push(instance.receiver().label);
		return out;
	}
	static get __name__() {
		return "syntaxcodeforms.ZeroArgument"
	}
	get __class__() {
		return ZeroArgument
	}
}
ZeroArgument.prototype.label = null;

//# sourceMappingURL=ZeroArgument.js.map
