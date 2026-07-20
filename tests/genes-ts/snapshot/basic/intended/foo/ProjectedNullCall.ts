import {Register} from "../genes/Register.js"

/**
 * Paired projected-null behavior and ordinary non-nullability control.
 */
export class ProjectedNullCall {
	static acceptProjected(value: null): void {
	}
	static acceptRequired(value: string): void {
	}
	static demo(nullable: string | null): void {
		ProjectedNullCall.acceptProjected(null);
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
