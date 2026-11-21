import type {JSX} from "react"
import "./Panel.js"
import {Panel_Fields_} from "./Panel.fields.js"
import {Register} from "../genes/Register.js"

/**
 * Only components and types: this module is not split. It uses only a
 * non-component function of the split module `Panel`, so it imports
 * `Panel.js` for its side effect and `formatCount` from `Panel.fields.js`.
 */
export type GreetingProps = {
	name: string
}

export function Greeting(props: GreetingProps): JSX.Element {
	const props1: string = props.name;
	const tmp: string = Panel_Fields_.formatCount(1);
	return <p data-greeting="">Hello {props1}{tmp}</p>;
}
