import {Fetch} from "../extern/Fetch"
import {Register} from "../../genes/Register"
import type {FetchResponse, FetchHeaders, FetchRequestInit} from "../extern/Fetch"
import type {Todo} from "../shared/Todo"
import type {ErrorResponse, TodoListResponse, TodoResponse, CreateTodoBody} from "../shared/Api"

export class Client {

	/**
	 * Decode a response after a route-specific method has issued the request.
	 */
	static decodeResponse<T>(res: FetchResponse): globalThis.Promise<T> {
		if (res.status == 204) {
			return globalThis.Promise.reject({"error": "no_content"});
		};
		if (res.ok) {
			return res.json();
		};
		const jp: globalThis.Promise<ErrorResponse> = res.json();
		return jp.then(function (err: ErrorResponse) {
			return globalThis.Promise.reject(err);
		});
	}
	static listTodos(): globalThis.Promise<Todo[]> {
		const headers: FetchHeaders = {};
		const opts: FetchRequestInit = {"method": "GET", "headers": headers};
		const p: globalThis.Promise<TodoListResponse> = Fetch.fetch("/api/todos", opts).then(function (res: FetchResponse) {
			return Client.decodeResponse(res);
		});
		return p.then(function (res: TodoListResponse) {
			return res.todos;
		});
	}
	static getTodo(id: string): globalThis.Promise<Todo> {
		const headers: FetchHeaders = {};
		const opts: FetchRequestInit = {"method": "GET", "headers": headers};
		const p: globalThis.Promise<TodoResponse> = Fetch.fetch("/api/todos/" + id, opts).then(function (res: FetchResponse) {
			return Client.decodeResponse(res);
		});
		return p.then(function (res: TodoResponse) {
			return res.todo;
		});
	}
	static createTodo(title: string): globalThis.Promise<Todo> {
		const body: CreateTodoBody = {"title": title};
		const headers: FetchHeaders = {};
		headers["Content-Type"] = "application/json";
		const opts: FetchRequestInit = {"method": "POST", "headers": headers, "body": JSON.stringify(body)};
		const p: globalThis.Promise<TodoResponse> = Fetch.fetch("/api/todos", opts).then(function (res: FetchResponse) {
			return Client.decodeResponse(res);
		});
		return p.then(function (res: TodoResponse) {
			return res.todo;
		});
	}
	static updateTodoTitle(id: string, title: string): globalThis.Promise<Todo> {
		const headers: FetchHeaders = {};
		headers["Content-Type"] = "application/json";
		const opts: FetchRequestInit = {"method": "PATCH", "headers": headers, "body": JSON.stringify({"title": title})};
		const p: globalThis.Promise<TodoResponse> = Fetch.fetch("/api/todos/" + id, opts).then(function (res: FetchResponse) {
			return Client.decodeResponse(res);
		});
		return p.then(function (res: TodoResponse) {
			return res.todo;
		});
	}
	static updateTodoCompleted(id: string, completed: boolean): globalThis.Promise<Todo> {
		const headers: FetchHeaders = {};
		headers["Content-Type"] = "application/json";
		const opts: FetchRequestInit = {"method": "PATCH", "headers": headers, "body": JSON.stringify({"completed": completed})};
		const p: globalThis.Promise<TodoResponse> = Fetch.fetch("/api/todos/" + id, opts).then(function (res: FetchResponse) {
			return Client.decodeResponse(res);
		});
		return p.then(function (res: TodoResponse) {
			return res.todo;
		});
	}
	static deleteTodo(id: string): globalThis.Promise<boolean> {
		const headers: FetchHeaders = {};
		return Fetch.fetch("/api/todos/" + id, {"method": "DELETE", "headers": headers}).then(function (res: FetchResponse) {
			if (res.status == 204) {
				return globalThis.Promise.resolve(true);
			};
			const jp: globalThis.Promise<ErrorResponse> = res.json();
			return jp.then(function (err: ErrorResponse) {
				return globalThis.Promise.reject(err);
			});
		});
	}
	static get __name__(): string {
		return "todo.web.Client"
	}
	get __class__(): Function {
		return Client
	}
}
Register.setHxClass("todo.web.Client", Client);
