import {Register} from "../genes/Register.js"

/**
 * Sibling argument whose correct spelling needs its expected record type.
 *
 * Why: fixing the preceding `null` argument must not make the call emitter
 * forget how later arguments are declared. What: Haxe calls the required field
 * `label`, while JavaScript receives the property name `function`; the
 * optional field writes Haxe `null` as JavaScript `undefined`. How: `@:native`
 * owns the host property name and `@:ts.optional` owns the optional-property
 * null/undefined boundary. Both facts live on this expected record type.
 */
export type ProjectedNullSibling = {
	function: string,
	note?: string | undefined
}

/**
 * Paired projected-null behavior and ordinary non-nullability control.
 */
export class ProjectedNullCall {
	static acceptProjected(value: null): void {
	}
	static acceptPair(value: null, sibling: ProjectedNullSibling): void {
	}
	static acceptRequired(value: string): void {
	}
	static demo(nullable: string | null): void {
		ProjectedNullCall.acceptProjected(null);
		ProjectedNullCall.acceptPair(null, {"function": "kept", "note": (null ?? undefined)});
		ProjectedNullCall.acceptRequired(Register.unsafeCast<string>(nullable));
	}
	static get __name__(): string {
		return "foo.ProjectedNullCall"
	}
	get __class__(): Function {
		return ProjectedNullCall
	}
}
Register.setHxClass("foo.ProjectedNullCall", ProjectedNullCall);
