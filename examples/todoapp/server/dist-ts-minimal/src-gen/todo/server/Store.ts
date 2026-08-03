import {TodoId} from "../shared/TodoId.js"
import * as Fs from "fs"
import {Exception} from "../../haxe/Exception.js"
import {Register} from "../../genes/Register.js"
import type {Todo} from "../shared/Todo.js"
import type {Console} from "console"

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
		const _g1: Todo[] = this.todos;
		while (_g < _g1.length) {
			const t: Todo = _g1[_g]!;
			++_g;
			if (t.id == id) {
				return Register.unsafeCast<Todo | null>(t);
			};
		};
		return null;
	}
	create(title: string): Todo {
		const now: string = Store.nowIso();
		const todo: Todo = {"id": TodoId.create(), "title": title, "completed": false, "createdAt": now, "updatedAt": now};
		this.todos.push(todo);
		this.save();
		return todo;
	}
	updateTitle(id: string, title: string): Todo | null {
		return this.updateFields(id, title, null);
	}
	updateCompleted(id: string, completed: boolean): Todo | null {
		return this.updateFields(id, null, completed);
	}
	updateBoth(id: string, title: string, completed: boolean): Todo | null {
		return this.updateFields(id, title, completed);
	}
	updateFields(id: string, title: string | null, completed: boolean | null): Todo | null {
		const todo: Todo | null = this.get(id);
		if (todo == null) {
			return null;
		};
		if (title != null) {
			todo.title = title;
		};
		if (completed != null) {
			todo.completed = completed;
		};
		todo.updatedAt = Store.nowIso();
		this.save();
		return todo;
	}
	remove(id: string): boolean {
		let _g_1: number = 0;
		const _g1_1: number = this.todos.length;
		while (_g_1 < _g1_1) {
			const i: number = _g_1++;
			if (this.todos[i]!.id == id) {
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
			if (!Fs.existsSync(this.dataPath)) {
				return;
			};
			const raw: string = Fs.readFileSync(this.dataPath, "utf8");
			const parsed: PersistedStore = JSON.parse(raw);
			const arr: Todo[] = parsed.todos;
			if (arr == null) {
				return;
			};
			let _g_2: number = 0;
			while (_g_2 < arr.length) {
				const t: Todo = arr[_g_2]!;
				++_g_2;
				this.todos.push(t);
			};
		}catch (_g_3) {
			const e: Exception = Exception.caught(_g_3);
			this.console.error("Failed to load data:", e);
		};
	}
	save(): void {
		if (this.dataPath == null) {
			return;
		};
		try {
			const payload: {
				todos: Todo[]
			} = {"todos": this.todos};
			Fs.writeFileSync(this.dataPath, JSON.stringify(payload, null, "  "), "utf8");
		}catch (_g_4) {
			const e: Exception = Exception.caught(_g_4);
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
