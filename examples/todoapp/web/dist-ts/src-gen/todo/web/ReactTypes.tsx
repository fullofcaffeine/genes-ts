import type {JSX} from "react"
import {Register} from "../../genes/Register"

export type ReactElement = JSX.Element

export type ReactChild = JSX.Element | string | null

export type ReactComponent = (() => JSX.Element)

export type ReactComponent1<P> = ((arg0: P) => JSX.Element)

export type ChangeEvent = {
	target: {
		value: string
	}
}
