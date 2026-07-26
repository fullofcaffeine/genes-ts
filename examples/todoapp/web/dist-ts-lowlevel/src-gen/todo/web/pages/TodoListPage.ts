import type {JSX} from "react"
import * as React__genes_jsx from "react"
import {useState, useEffect} from "react"
import __genes_import_PrettyButton from "../../../../src-ts/components/PrettyButton"
import {interopBanner as __genes_import_interopBanner} from "../../../../src-ts/interop/haxeInterop"
import {TodoText} from "../../shared/TodoText"
import {React_Fields_} from "../../extern/React"
import {Client} from "../Client"
import {StringTools} from "../../../StringTools"
import {Link} from "react-router-dom"
import {Register} from "../../../genes/Register"
import type {ReactComponent1, ReactChild, ChangeEvent} from "../ReactTypes"
import type {Todo} from "../../shared/Todo"

export class TodoListPage {
	declare static PrettyButton: ReactComponent1<PrettyButtonProps>;
	declare static interopBanner: (() => string);
	static Component(): JSX.Element {
		const _keepTodoText: string = TodoText.interopBanner();
		const todosState: [ Todo[], import('react').Dispatch<import('react').SetStateAction<Todo[]>> ] = useState<Todo[]>([]);
		const todos: Todo[] = (todosState[0] ?? null);
		const titleState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		const title: string = (titleState[0] ?? null);
		const errorState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		const error: string = (errorState[0] ?? null);
		useEffect(function () {
			Client.listTodos().then(function (next: Todo[]) {
				const setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
				setter(next);
			})["catch"](function (_) {
				const setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Failed to load todos");
			});
		}, []);
		const replaceTodo: ((updated: Todo) => void) = function (updated: Todo) {
			const _g: Todo[] = [];
			let _g1: number = 0;
			while (_g1 < todos.length) {
				const t: Todo = todos[_g1]!;
				++_g1;
				_g.push((t.id == updated.id) ? updated : t);
			};
			const next: Todo[] = _g;
			const setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
			setter(next);
		};
		const removeTodo: ((id: string) => void) = function (id: string) {
			const _g_1: Todo[] = [];
			let _g1_1: number = 0;
			while (_g1_1 < todos.length) {
				const t: Todo = todos[_g1_1]!;
				++_g1_1;
				if (t.id != id) {
					_g_1.push(t);
				};
			};
			const next: Todo[] = _g_1;
			const setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
			setter(next);
		};
		const onAdd: (() => void) = function () {
			const trimmed: string = StringTools.trim(title);
			if (trimmed.length == 0) {
				const setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Title is required");
				return;
			};
			const setter_1: ((arg0: string) => void) = (errorState[1] ?? null);
			setter_1("");
			Client.createTodo(trimmed).then(function (todo: Todo) {
				const next: Todo[] = todos.concat([todo]);
				const setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
				setter(next);
				const setter1: ((arg0: string) => void) = (titleState[1] ?? null);
				setter1("");
			})["catch"](function (_) {
				const setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Failed to create todo");
			});
		};
		const errorView: ReactChild = (error != "") ? React__genes_jsx.createElement("p", ({style: {"color": "crimson"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"p"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), error) : Register.unsafeCast<ReactChild>(null);
		const renderTodoTitle: ((todo: Todo) => ReactChild) = function (todo: Todo) {
			if (todo.completed) {
				return React__genes_jsx.createElement("s", null, todo.title);
			} else {
				return todo.title;
			};
		};
		const renderTodoItem: ((todo: Todo) => JSX.Element) = function (todo: Todo) {
			return React__genes_jsx.createElement("li", ({key: todo.id, style: {"display": "flex", "alignItems": "center", "gap": "8px", "padding": "8px 0", "borderBottom": "1px solid #eee"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"li"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), React__genes_jsx.createElement("input", ({type: "checkbox", checked: todo.completed, onChange: function () {
				return Client.updateTodo(todo.id, {"completed": !todo.completed}).then(function (updated: Todo) {
					replaceTodo(updated);
					return null;
				});
			}} satisfies (React__genes_jsx.ComponentPropsWithRef<"input"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))), React__genes_jsx.createElement(Link, ({to: "/todos/" + todo.id, style: {"flex": "1"}, children: renderTodoTitle(todo)} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof Link> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))), React__genes_jsx.createElement("button", ({onClick: function () {
				return Client.deleteTodo(todo.id).then(function (_: boolean) {
					removeTodo(todo.id);
					return null;
				});
			}} satisfies (React__genes_jsx.ComponentPropsWithRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), " Delete "));
		};
		const tmp: JSX.Element = React__genes_jsx.createElement("h2", null, "Todos");
		const tmp1: JSX.Element = React__genes_jsx.createElement("input", ({value: title, placeholder: "New todo", onChange: function (e: ChangeEvent) {
			const setter: ((arg0: string) => void) = (titleState[1] ?? null);
			setter(e.target.value);
		}, style: {"flex": "1", "padding": "8px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"input"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp2: JSX.Element = React__genes_jsx.createElement(TodoListPage.PrettyButton, ({label: "Add", onClick: function () {
			onAdd();
		}, variant: "primary"} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof TodoListPage.PrettyButton> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp3: JSX.Element = React__genes_jsx.createElement("div", ({style: {"display": "flex", "gap": "8px", "marginBottom": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp1, tmp2);
		const f: ((arg0: Todo) => JSX.Element) = renderTodoItem;
		const result: JSX.Element[] = new Array(todos.length);
		let _g_2: number = 0;
		const _g1_2: number = todos.length;
		while (_g_2 < _g1_2) {
			const i: number = _g_2++;
			result[i] = f(todos[i]!);
		};
		const tmp4: JSX.Element = React__genes_jsx.createElement("ul", ({style: {"listStyle": "none", "padding": "0", "margin": "0"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"ul"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), result);
		const tmp5: string = TodoListPage.interopBanner();
		const tmp6: JSX.Element = React__genes_jsx.createElement("p", ({style: {"marginTop": "16px", "color": "#666", "fontSize": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"p"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp5);
		return React__genes_jsx.createElement("div", null, tmp, errorView, tmp3, tmp4, tmp6);
	}
	static get __name__(): string {
		return "todo.web.pages.TodoListPage"
	}
	get __class__(): Function {
		return TodoListPage
	}
}
Register.setHxClass("todo.web.pages.TodoListPage", TodoListPage);


TodoListPage.PrettyButton = __genes_import_PrettyButton
TodoListPage.interopBanner = __genes_import_interopBanner
export type PrettyButtonProps = {
	label: string,
	onClick: () => void,
	variant?: 'primary' | 'danger' | null
}
