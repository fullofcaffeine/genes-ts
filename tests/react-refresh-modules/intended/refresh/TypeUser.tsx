import {Register} from "../genes/Register.js"
import type {Model, Kind, Named, WidgetProps} from "./Widget.js"

/**
 * Uses the class, enum and interface of the split module `Widget` only as
 * parameter types, so Genes writes a type-only import from `Widget.js`.
 */
export class TypeUser {
	static describe(model: Model, kind: Kind, named: Named, props: WidgetProps): string {
		return "typed";
	}
	static get __name__(): string {
		return "refresh.TypeUser"
	}
	get __class__(): Function {
		return TypeUser
	}
}
Register.setHxClass("refresh.TypeUser", TypeUser);
