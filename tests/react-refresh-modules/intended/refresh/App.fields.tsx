import type {JSX} from "react"
import {Panel} from "./Panel.js"
import {Tone, Counter, Panel_Fields_} from "./Panel.fields.js"
import {Std} from "../Std.js"
import {Greeting} from "./Greeting.js"
import {Label, Registry} from "./Unsplit.js"
import {Register} from "../genes/Register.js"

export class App_Fields_ {

	/**
	 * Imports a component, a module-level function, a class and an enum of `Panel`.
	 */
	static App(): JSX.Element;
	static App(): never {
		throw this;
	}

	/**
	 * An ordinary module-level function: `App` is split too.
	 */
	static appTitle(): string {
		return "fixture";
	}
	static get __name__(): string {
		return "refresh._App.App_Fields_"
	}
	get __class__(): Function {
		return App_Fields_
	}
}
Register.setHxClass("refresh._App.App_Fields_", App_Fields_);


export const appTitle = App_Fields_.appTitle
