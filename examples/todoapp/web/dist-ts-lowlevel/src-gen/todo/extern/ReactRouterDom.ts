import {Register} from "../../genes/Register"

/**
* Params returned by `useParams()`.
*
* `useParams()` is typed in TS as:
* `Readonly<Record<string, string | undefined>>`.
*
* We represent it as a dynamic string-keyed map on the Haxe side.
* In TS output, `@:ts.type` ensures consumers see the correct Router type.
*/
export type Params = Readonly<Record<string, string | undefined>>

export class ReactRouterDom_Fields_ {
	static get __name__(): string {
		return "todo.extern._ReactRouterDom.ReactRouterDom_Fields_"
	}
	get __class__(): Function {
		return ReactRouterDom_Fields_
	}
}
Register.setHxClass("todo.extern._ReactRouterDom.ReactRouterDom_Fields_", ReactRouterDom_Fields_);
