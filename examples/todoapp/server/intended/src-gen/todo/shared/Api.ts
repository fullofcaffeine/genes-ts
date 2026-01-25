import type {Todo} from "./Todo.js"
import {Register} from "../../genes/Register.js"

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
