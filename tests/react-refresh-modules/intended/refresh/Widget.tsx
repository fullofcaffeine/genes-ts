import type {JSX} from "react"
import {Register} from "../genes/Register.js"
import {Named, Model, Kind} from "./Widget.fields.js"
import type {WidgetProps} from "./Widget.fields.js"

export function WidgetView(props: WidgetProps): JSX.Element {
	const tmp: string = props.model.label();
	return <span data-widget="">{tmp}</span>;
}
export function WidgetFrame(props: WidgetProps): JSX.Element {
	const tmp: JSX.Element = <WidgetView model={props.model} />;
	return <div>{tmp}</div>;
}
export type {WidgetProps, Named, Model, Kind}
