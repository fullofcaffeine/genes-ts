import {Register} from "../../genes/Register"

/**
Native JavaScript iterator structure. To enable haxe for-in iteration, use `js.lib.HaxeIterator`, for example `for (v in new js.lib.HaxeIterator(jsIterator))` or add `using js.lib.HaxeIterator;` to your module

See [Iteration Protocols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols)
*/
export type Iterator<T> = {
	next: () => IteratorResult<T, undefined>
}

/**
Native JavaScript async iterator structure.

See [for await...of](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
*/
export type AsyncIterator<T> = {
	next: () => Promise<IteratorResult<T, undefined>>
}

export type IteratorStep<T> = {
	done: boolean,
	value?: T | null
}
