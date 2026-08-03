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
 * The union makes at least one property required for both Haxe and TypeScript
 * callers. `@:ts.optional` removes Haxe's synthetic `null` from the optional
 * sibling property, so TypeScript does not advertise explicit JSON `null`.
 */
export type UpdateTodoBody = UpdateTodoTitleBody | UpdateTodoCompletedBody
