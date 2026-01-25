import {Register} from "../../genes/Register"

export type ReactElement = JSX.Element

export type ReactChild = ReactElement | string | null

export type ReactComponent = (() => ReactElement)

export type ReactDeps = import('react').DependencyList

export type ChangeEvent = {
	target: {
		value: string
	}
}
