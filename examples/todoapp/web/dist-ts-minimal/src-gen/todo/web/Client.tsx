import type {Todo} from "../shared/Todo"
import type {UpdateTodoBody, ErrorResponse, TodoListResponse, TodoResponse, CreateTodoBody} from "../shared/Api"
import {Fetch} from "../extern/Fetch"
import type {FetchHeaders, FetchRequestInit, FetchResponse} from "../extern/Fetch"
import {Register} from "../../genes/Register"

export class Client {
	static requestJson<T>(method: string, url: string, body: {
	} | null = null): Promise<T> {
		let headers: FetchHeaders = {};
		headers["Content-Type"] = "application/json";
		let opts: FetchRequestInit = {"method": method, "headers": headers};
		if (body != null) {
			opts.body = JSON.stringify(body);
		};
		return Fetch.fetch(url, opts).then(function (res: FetchResponse) {
			if (res.status == 204) {
				return Promise.reject({"error": "no_content"});
			};
			if (res.ok) {
				return res.json();
			};
			let jp: Promise<ErrorResponse> = res.json();
			return jp.then(function (err: ErrorResponse) {
				return Promise.reject(err);
			});
		});
	}
	static listTodos(): Promise<Todo[]> {
		let p: Promise<TodoListResponse> = Client.requestJson("GET", "/api/todos");
		return p.then(function (res: TodoListResponse) {
			return res.todos;
		});
	}
	static getTodo(id: string): Promise<Todo> {
		let p: Promise<TodoResponse> = Client.requestJson("GET", "/api/todos/" + id);
		return p.then(function (res: TodoResponse) {
			return res.todo;
		});
	}
	static createTodo(title: string): Promise<Todo> {
		let body: CreateTodoBody = {"title": title};
		let p: Promise<TodoResponse> = Client.requestJson("POST", "/api/todos", body);
		return p.then(function (res: TodoResponse) {
			return res.todo;
		});
	}
	static updateTodo(id: string, patch: UpdateTodoBody): Promise<Todo> {
		let p: Promise<TodoResponse> = Client.requestJson("PATCH", "/api/todos/" + id, patch);
		return p.then(function (res: TodoResponse) {
			return res.todo;
		});
	}
	static deleteTodo(id: string): Promise<boolean> {
		let headers: FetchHeaders = {};
		return Fetch.fetch("/api/todos/" + id, {"method": "DELETE", "headers": headers}).then(function (res: FetchResponse) {
			if (res.status == 204) {
				return Promise.resolve(true);
			};
			let jp: Promise<ErrorResponse> = res.json();
			return jp.then(function (err: ErrorResponse) {
				return Promise.reject(err);
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
