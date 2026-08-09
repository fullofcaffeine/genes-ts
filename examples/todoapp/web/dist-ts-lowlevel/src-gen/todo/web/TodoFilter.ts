import {Register} from "../../genes/Register"

/**
 * The user-selected subset of todos shown on the list page.
 *
 * This is an ordinary Haxe enum so the maintained application exercises a
 * closed domain value through both Genes output profiles. The list page's
 * exhaustive switch is the single owner of what each choice means.
 */
export declare namespace TodoFilter {
	export const __ename__: string;
	export type All = {_hx_index: 0, __enum__: "todo.web.TodoFilter"}
	export const All: All;
	export type Open = {_hx_index: 1, __enum__: "todo.web.TodoFilter"}
	export const Open: Open;
	export type Completed = {_hx_index: 2, __enum__: "todo.web.TodoFilter"}
	export const Completed: Completed;
	export type __Construct = typeof All | typeof Open | typeof Completed;
	export const __constructs__: __Construct[];
	export type __EmptyConstruct = typeof All | typeof Open | typeof Completed;
	export const __empty_constructs__: __EmptyConstruct[];
}

/**
 * The user-selected subset of todos shown on the list page.
 *
 * This is an ordinary Haxe enum so the maintained application exercises a
 * closed domain value through both Genes output profiles. The list page's
 * exhaustive switch is the single owner of what each choice means.
 */
export type TodoFilter =
	| TodoFilter.All
	| TodoFilter.Open
	| TodoFilter.Completed
export function TodoFilter() {}

Register.setHxEnum("todo.web.TodoFilter", TodoFilter);

Object.assign(TodoFilter, {
	__ename__: "todo.web.TodoFilter",
	All: {_hx_name: "All", _hx_index: 0, __enum__: "todo.web.TodoFilter"},
	Open: {_hx_name: "Open", _hx_index: 1, __enum__: "todo.web.TodoFilter"},
	Completed: {_hx_name: "Completed", _hx_index: 2, __enum__: "todo.web.TodoFilter"}
});

Object.assign(TodoFilter, {
	__constructs__: [TodoFilter.All, TodoFilter.Open, TodoFilter.Completed],
	__empty_constructs__: [TodoFilter.All, TodoFilter.Open, TodoFilter.Completed]
});
