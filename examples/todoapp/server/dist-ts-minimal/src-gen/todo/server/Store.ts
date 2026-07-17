import {TodoId} from "../shared/TodoId.js"
import * as Fs from "fs"
import {Exception} from "../../haxe/Exception.js"
import {Register} from "../../genes/Register.js"
import type {Todo} from "../shared/Todo.js"
import type {Console} from "console"
import type {UpdateTodoBody} from "../shared/Api.js"

export type PersistedStore = {
	todos: Todo[]
}

export class Store extends Register.inherits() {
	constructor(dataPath: string | null = null) {
		super(dataPath);
	}
	declare todos: Todo[];
	declare dataPath: string | null;
	declare console: Console;
	[Register.new](...args: never[]): void;
	[Register.new](dataPath: string | null = null): void {
		this.todos = [];
		this.dataPath = dataPath;
		this.console = console;
		if (dataPath != null) {
			this.load();
		};
	}
	list(): Todo[] {
		return this.todos.slice();
	}
	get(id: string): Todo | null {
		let _g: number = 0;
		let _g1: Todo[] = this.todos;
		while (_g < _g1.length) {
			let t: Todo = _g1[_g];
			++_g;
			if (t.id == id) {
				return t;
			};
		};
		return null;
	}
	create(title: string): Todo {
		let now: string = Store.nowIso();
		let todo: Todo = {"id": TodoId.create(), "title": title, "completed": false, "createdAt": now, "updatedAt": now};
		this.todos.push(todo);
		this.save();
		return todo;
	}
	update(id: string, patch: UpdateTodoBody): Todo | null {
		let todo: Todo | null = this.get(id);
		if (todo == null) {
			return null;
		};
		if ((patch.title ?? null) != null) {
			todo.title = (patch.title!);
		};
		if ((patch.completed ?? null) != null) {
			todo.completed = (patch.completed!);
		};
		todo.updatedAt = Store.nowIso();
		this.save();
		return todo;
	}
	remove(id: string): boolean {
		let _g_1: number = 0;
		let _g1_1: number = this.todos.length;
		while (_g_1 < _g1_1) {
			let i: number = _g_1++;
			if (this.todos[i].id == id) {
				this.todos.splice(i, 1);
				this.save();
				return true;
			};
		};
		return false;
	}
	load(): void {
		if (this.dataPath == null) {
			return;
		};
		try {
			if (!Fs.existsSync(Register.unsafeCast<import("node:fs").PathLike>(this.dataPath))) {
				return;
			};
			let raw: string = Fs.readFileSync(Register.unsafeCast<import("node:fs").PathLike>(this.dataPath), "utf8");
			let parsed: PersistedStore = JSON.parse(raw);
			let arr: Todo[] = parsed.todos;
			if (arr == null) {
				return;
			};
			let _g_2: number = 0;
			while (_g_2 < arr.length) {
				let t: Todo = arr[_g_2];
				++_g_2;
				this.todos.push(t);
			};
		}catch (_g_3) {
			let e: Exception = Exception.caught(_g_3);
			this.console.error("Failed to load data:", e);
		};
	}
	save(): void {
		if (this.dataPath == null) {
			return;
		};
		try {
			let payload: {
				todos: Todo[]
			} = {"todos": this.todos};
			Fs.writeFileSync(Register.unsafeCast<import("node:fs").PathLike>(this.dataPath), JSON.stringify(payload, null, "  "), "utf8");
		}catch (_g_4) {
			let e: Exception = Exception.caught(_g_4);
			this.console.error("Failed to save data:", e);
		};
	}
	static nowIso(): string {
		return new Date().toISOString();
	}
	static get __name__(): string {
		return "todo.server.Store"
	}
	get __class__(): Function {
		return Store
	}
}
Register.seedProtoField(Store, "todos");

Register.seedProtoField(Store, "dataPath");

Register.seedProtoField(Store, "console");
