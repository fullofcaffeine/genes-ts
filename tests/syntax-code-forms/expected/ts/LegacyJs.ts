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
export class LegacyJs {
	static run(): string[] {
		const out: string[] = [];
		let a: number = 3;
		let b: number = 4;
		Reflect.set(globalThis, '__legacyJs', 1);
		const identifier: number = Infinity;
		out.push((identifier == null) ? "null" : "" + identifier);
		const dotted: number = Math.max(1, 2);
		out.push((dotted == null) ? "null" : "" + dotted);
		const sum: number = a + b;
		out.push((sum == null) ? "null" : "" + sum);
		const repeated: number = a + a + Other.two();
		out.push((repeated == null) ? "null" : "" + repeated);
		const imported: number = Other.counter + 2;
		out.push((imported == null) ? "null" : "" + imported);
		const text: string = "text".toUpperCase();
		out.push(text);
		const product: number = (a + b) * 2;
		out.push((product == null) ? "null" : "" + product);
		const negated: number = (-a).toString().length;
		out.push((negated == null) ? "null" : "" + negated);
		const castValue: number = (a + b) * 3;
		out.push((castValue == null) ? "null" : "" + castValue);
		const doubled: string = JSON.stringify([{a: a}, {}]);
		out.push(doubled);
		Reflect.set(globalThis, '__legacyJs', b);
		const stored: number = Reflect.get(globalThis, '__legacyJs');
		out.push((stored == null) ? "null" : "" + stored);
		return out;
	}
	static get __name__(): string {
		return "syntaxcodeforms.LegacyJs"
	}
	get __class__(): Function {
		return LegacyJs
	}
}
Register.setHxClass("syntaxcodeforms.LegacyJs", LegacyJs);

//# sourceMappingURL=LegacyJs.ts.map
