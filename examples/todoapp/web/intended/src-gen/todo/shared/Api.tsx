import type {Todo} from "./Todo"
import {Register} from "../../genes/Register"

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
