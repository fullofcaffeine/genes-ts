import type {JSX} from "react"
import {CycleDep} from "./CycleDep.js"
import {Register} from "../genes/Register.js"

export type CycleProps = {
	n: number
}

export function cycleRender(): JSX.Element {
	return CycleBadge({"n": 1});
}
export function CycleBadge(props: CycleProps): JSX.Element {
	return <s data-cycle="">{(props.n == null) ? "null" : "" + props.n}</s>;
}
export class Cycle_Fields_ {

	/**
	 * Keeps `Cycle_Fields_`: an ordinary module function.
	 */
	static cyclePlain(): number {
		return CycleDep.value() + 1;
	}

	/**
	 * A direct (hoisted) function that reads a component. `CycleDep.__init__`
	 * calls it during the import cycle, before a split sibling would have
	 * defined `Cycle_Fields_`, so the module stays one file.
	 */
	static cycleRender(): JSX.Element;
	static cycleRender(): never {
		throw this;
	}
	static CycleBadge(props: CycleProps): JSX.Element;
	static CycleBadge(): never {
		throw this;
	}
	static get __name__(): string {
		return "refresh._Cycle.Cycle_Fields_"
	}
	get __class__(): Function {
		return Cycle_Fields_
	}
}
Cycle_Fields_.cycleRender = cycleRender;
Cycle_Fields_.CycleBadge = CycleBadge;
Register.setHxClass("refresh._Cycle.Cycle_Fields_", Cycle_Fields_);


export const cyclePlain = Cycle_Fields_.cyclePlain
