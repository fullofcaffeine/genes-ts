import type {JSX} from "react"
import {Register} from "../genes/Register.js"

export type LabelProps = {
	text: string
}

export function Label(props: LabelProps): JSX.Element {
	return <em data-label="">{props.text}</em>;
}
/**
 * `defaultView` reads `Label` during module load, so Genes keeps this module
 * as one file: a split sibling would read the slot before it is set.
 */
export class Registry {
	declare static defaultView: ((arg0: LabelProps) => JSX.Element);
	static get __name__(): string {
		return "refresh.Registry"
	}
	get __class__(): Function {
		return Registry
	}
}
Register.setHxClass("refresh.Registry", Registry);


Registry.defaultView = Label
