import type {JSX} from "react"
import {Register} from "../genes/Register.js"

/**
 * Only components and types: this module is not split.
 */
export type GreetingProps = {
	name: string
}

export function Greeting(props: GreetingProps): JSX.Element {
	return <p data-greeting="">Hello {props.name}</p>;
}
