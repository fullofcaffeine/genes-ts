import type {JSX} from "react"
import {Register} from "../genes/Register.js"
import {LazyEntry, Lazy_Fields_, lazyLabel} from "./Lazy.fields.js"

export function LazyView(): JSX.Element {
	const tmp: string = Lazy_Fields_.lazyLabel();
	return <em data-lazy="">{tmp}</em>;
}
Lazy_Fields_.LazyView = LazyView;
export type {LazyEntry, Lazy_Fields_}
