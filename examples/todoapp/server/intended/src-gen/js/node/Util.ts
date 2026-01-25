import {Register} from "../../genes/Register.js"

/**
Options object used by `Util.inspect`.
*/
export type InspectOptionsBase = {
	/**
	If `true`, then the output will be styled with ANSI color codes.

	Default: false.
	*/
	colors?: boolean | null,
	/**
	Specifies the number of times to recurse while formatting the `object`.
	This is useful for inspecting large complicated objects.
	To make it recurse up to the maximum call stack size pass `Math.POSITIVE_INFINITY` or `null`.

	Default: 2.
	*/
	depth?: number | null,
	/**
	If `true`, the `object`'s non-enumerable symbols and properties will be included in the formatted result
	as well as WeakMap and WeakSet entries.

	Default: false.
	*/
	showHidden?: boolean | null
}

export type InspectOptions = {
	/**
	The length at which an object's keys are split across multiple lines.

	Set to `Math.POSITIVE_INFINITY` to format an object as a single line.

	Default: 60 for legacy compatibility.
	*/
	breakLength?: number | null,
	/**
	If `true`, then the output will be styled with ANSI color codes.

	Default: false.
	*/
	colors?: boolean | null,
	/**
	Setting this to false changes the default indentation to use a line break for each object key instead of lining up
	multiple properties in one line. It will also break text that is above the breakLength size into smaller and better
	readable chunks and indents objects the same as arrays.

	Note that no text will be reduced below 16 characters, no matter the breakLength size.

	Default: true.
	*/
	compact?: number | null,
	/**
	If `false`, then custom `inspect(depth, opts)` functions will not be called.

	Default: true.
	*/
	customInspect?: boolean | null,
	/**
	Specifies the number of times to recurse while formatting the `object`.
	This is useful for inspecting large complicated objects.
	To make it recurse up to the maximum call stack size pass `Math.POSITIVE_INFINITY` or `null`.

	Default: 2.
	*/
	depth?: number | null,
	/**
	Specifies the maximum number of Array, TypedArray, WeakMap and WeakSet elements to include when formatting.

	Set to `null` or `Math.POSITIVE_INFINITY` to show all elements.

	Set to `0` or negative to show no elements.

	Default: 100.
	*/
	maxArrayLength?: number | null,
	/**
	If `true`, the `object`'s non-enumerable symbols and properties will be included in the formatted result
	as well as WeakMap and WeakSet entries.

	Default: false.
	*/
	showHidden?: boolean | null,
	/**
	If `true`, then objects and functions that are Proxy objects will be introspected to show their `target` and `handler` objects.

	Default: false.
	*/
	showProxy?: boolean | null,
	/**
	If set to `true` or a function, all properties of an object and Set and Map entries will be sorted in the returned string.
	If set to `true` the default sort is going to be used. If set to a function, it is used as a compare function.
	*/
	sorted?: boolean | ((arg0: any, arg1: any) => number) | null
}
