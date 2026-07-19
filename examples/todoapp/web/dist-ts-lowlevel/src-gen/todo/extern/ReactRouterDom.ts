import {Register} from "../../genes/Register"

/**
 * Params returned by `useParams()`.
 *
 * `useParams()` is typed in TS as:
 * `Readonly<Record<string, string | undefined>>`.
 *
 * We represent it as `DynamicAccess<String>` because route parameter names are
 * chosen by each application's URL patterns and cannot be enumerated in this
 * small generic extern. The value type remains `String`, and the weak key
 * boundary is confined to this return type rather than leaking through the
 * component property contracts.
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
