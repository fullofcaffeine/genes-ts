import type {JSX} from "react"
import {Register} from "./genes/Register.js"

/**
 * Proves a React element type can appear in TSX without authored JSX markup.
 *
 * The exported function is intentionally ordinary Haxe. Genes must retain its
 * `Element` annotations as `JSX.Element` and plan the matching type-only React
 * namespace import even though `JsxPlan` has no markup intent in this module.
 */
export class TypeOnlyJsxMain {
	static render(renderer: ((arg0: JSX.Element) => string), element: JSX.Element): string {
		return renderer(element);
	}
	static main(): void {
	}
	static get __name__(): string {
		return "TypeOnlyJsxMain"
	}
	get __class__(): Function {
		return TypeOnlyJsxMain
	}
}
Register.setHxClass("TypeOnlyJsxMain", TypeOnlyJsxMain);
