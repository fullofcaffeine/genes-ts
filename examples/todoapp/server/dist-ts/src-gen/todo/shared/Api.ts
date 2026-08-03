import {Register} from "../../genes/Register.js"
import type {Todo} from "./Todo.js"

export type TodoListResponse = {
	todos: Todo[]
}

export type TodoResponse = {
	todo: Todo
}

export type ErrorResponse = {
	error: string
}

export type CreateTodoBody = {
	title: string
}

export type UpdateTodoTitleBody = {
	completed?: boolean | undefined,
	title: string
}

export type UpdateTodoCompletedBody = {
	completed: boolean,
	title?: string | undefined
}

/**
 * A Todo update must change the title, completion state, or both.
 *
 * The wire-format union makes at least one property required. `@:ts.optional`
 * removes Haxe's synthetic `null` from the optional sibling in generated
 * TypeScript. Haxe application code uses Client's concrete update helpers
 * under package-scoped null safety rather than accepting this transport record
 * as a public call argument.
 */
export type UpdateTodoBody = UpdateTodoTitleBody | UpdateTodoCompletedBody
