import {Register} from "../../genes/Register"

export type ReactElement = JSX.Element

export type ReactChild = ReactElement | string | null

export type ReactComponent = (() => ReactElement)

export type ReactComponent1<P> = ((arg0: P) => ReactElement)

/**
* React hook dependency list type.
*
* Why:
* - We want the generated TS to be fully compatible with React's canonical types
*   from `@types/react`, without depending on a dedicated Haxe React library.
*
* What:
* - On the Haxe side we treat it as an array.
*
* How:
* - `@:ts.type` forces the emitted TS alias to be `import('react').DependencyList`.
* - We accept that the concrete element type is intentionally opaque to keep the
*   rest of the harness strongly typed.
*/
export type ReactDeps = import('react').DependencyList

export type ChangeEvent = {
	target: {
		value: string
	}
}
