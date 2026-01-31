import {Register} from "../../genes/Register"

/**
* Small shared helper used by the todoapp harness to prove:
*
* 1) genes-ts keeps *value* exports strongly typed (not just `type` exports), and
* 2) we can interop in both directions:
*    - TypeScript can import and call a Haxe-emitted value (`TodoText.interopBanner`)
*    - Haxe can import and call a TS-authored function that calls back into Haxe.
*
* This is intentionally simple and deterministic so it is stable in snapshots and
* easy to exercise in Playwright.
*/
export class TodoText {
	static interopBanner(): string {
		return "interop: ts-imports-haxe-ok";
	}
	static get __name__(): string {
		return "todo.shared.TodoText"
	}
	get __class__(): Function {
		return TodoText
	}
}
Register.setHxClass("todo.shared.TodoText", TodoText);
