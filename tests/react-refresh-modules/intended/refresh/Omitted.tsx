import type {JSX} from "react"
import {Register} from "../genes/Register.js"

export type OmittedProps = {
	n: number
}

export function renderOmitted(n: number): JSX.Element {
	return <OmittedBadge n={n} />;
}
export function OmittedBadge(props: OmittedProps): JSX.Element {
	return <b data-omitted="">{(props.n == null) ? "null" : "" + props.n}</b>;
}
