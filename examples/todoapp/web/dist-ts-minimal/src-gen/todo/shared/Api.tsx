import {Register} from "../../genes/Register"
import type {Todo} from "./Todo"

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

export type UpdateTodoBody = {
	completed?: boolean | null,
	title?: string | null
}
