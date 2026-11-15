import {Other} from "./Other.js"
import {Register} from "../genes/Register.js"

/**
 * Calls of `__js__`, the raw-code helper that older Haxe code and externs use.
 *
 * Why: Haxe 4 prints `__js__(template, values...)` like `js.Syntax.code`, but
 * Genes used to print only the single-identifier form itself. Each line below
 * is one other shape. `yarn test:syntax-code-forms` compares the emitted
 * module with the text that Haxe's printer produced for it. Values that Genes
 * lays out differently than Haxe are in `LegacyJsValues`.
 *
 * `untyped` is required here: Haxe exposes `__js__` only to untyped code. Each
 * result is assigned to a typed local at once.
 */
export const LegacyJs = Register.hxClasses()["syntaxcodeforms.LegacyJs"] =
class LegacyJs {
	static run() {
		const out = [];
		let a = 3;
		let b = 4;
		Reflect.set(globalThis, '__legacyJs', 1);
		const identifier = Infinity;
		out.push((identifier == null) ? "null" : "" + identifier);
		const dotted = Math.max(1, 2);
		out.push((dotted == null) ? "null" : "" + dotted);
		const sum = a + b;
		out.push((sum == null) ? "null" : "" + sum);
		const repeated = a + a + Other.two();
		out.push((repeated == null) ? "null" : "" + repeated);
		const imported = Other.counter + 2;
		out.push((imported == null) ? "null" : "" + imported);
		const text = "text".toUpperCase();
		out.push(text);
		const product = (a + b) * 2;
		out.push((product == null) ? "null" : "" + product);
		const negated = (-a).toString().length;
		out.push((negated == null) ? "null" : "" + negated);
		const castValue = (a + b) * 3;
		out.push((castValue == null) ? "null" : "" + castValue);
		const doubled = JSON.stringify([{a: a}, {}]);
		out.push(doubled);
		Reflect.set(globalThis, '__legacyJs', b);
		const stored = Reflect.get(globalThis, '__legacyJs');
		out.push((stored == null) ? "null" : "" + stored);
		return out;
	}
	static get __name__() {
		return "syntaxcodeforms.LegacyJs"
	}
	get __class__() {
		return LegacyJs
	}
}

//# sourceMappingURL=LegacyJs.js.map
