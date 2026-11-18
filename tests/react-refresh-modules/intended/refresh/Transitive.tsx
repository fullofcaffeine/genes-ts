import type {JSX} from "react"
import {Register} from "../genes/Register.js"

export type TransitiveProps = {
	count: number
}

export function TransitiveBadge(props: TransitiveProps): JSX.Element {
	return <i data-transitive="">{(props.count == null) ? "null" : "" + props.count}</i>;
}
export class Transitive_Fields_ {
	static make(): JSX.Element {
		return TransitiveBadge({"count": 1});
	}
	static TransitiveBadge(props: TransitiveProps): JSX.Element;
	static TransitiveBadge(): never {
		throw this;
	}
	static get __name__(): string {
		return "refresh._Transitive.Transitive_Fields_"
	}
	get __class__(): Function {
		return Transitive_Fields_
	}
}
Transitive_Fields_.TransitiveBadge = TransitiveBadge;
Register.setHxClass("refresh._Transitive.Transitive_Fields_", Transitive_Fields_);


export const make = Transitive_Fields_.make

/**
 * A static initializer reaches a component through a helper call. The
 * module stays one file: in a split module the helper would call the
 * placeholder slot while the sibling loads.
 */
export class Holder {
	declare static cached: JSX.Element;
	static get __name__(): string {
		return "refresh.Holder"
	}
	get __class__(): Function {
		return Holder
	}
}
Register.setHxClass("refresh.Holder", Holder);


Holder.cached = Transitive_Fields_.make()
