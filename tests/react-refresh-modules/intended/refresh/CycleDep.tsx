import type {JSX} from "react"
import {cycleRender} from "./Cycle.js"
import {Register} from "../genes/Register.js"

/**
 * Calls `Cycle.cycleRender` while it loads; `Cycle` imports this module.
 */
export class CycleDep {
	declare static rendered: JSX.Element | null;
	static value(): number {
		return 1;
	}
	static get __name__(): string {
		return "refresh.CycleDep"
	}
	get __class__(): Function {
		return CycleDep
	}
}
Register.setHxClass("refresh.CycleDep", CycleDep);


CycleDep.rendered = null
;CycleDep.rendered = cycleRender()
