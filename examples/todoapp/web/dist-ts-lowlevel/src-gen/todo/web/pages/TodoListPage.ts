import * as React__genes_jsx from "react"
import type {ReactComponent1, ReactElement, ReactChild, ChangeEvent} from "../ReactTypes"
import {Client} from "../Client"
import {TodoText} from "../../shared/TodoText"
import type {Todo} from "../../shared/Todo"
import {React_Fields_} from "../../extern/React"
import {Link} from "react-router-dom"
import {useState, useEffect} from "react"
import {Register} from "../../../genes/Register"
import {StringTools} from "../../../StringTools"
import {interopBanner as __genes_import_interopBanner} from "../../../../src-ts/interop/haxeInterop"
import __genes_import_PrettyButton from "../../../../src-ts/components/PrettyButton"

export class TodoListPage {
	declare static PrettyButton: ReactComponent1<PrettyButtonProps>;
	declare static interopBanner: (() => string);
	static Component(): ReactElement {
		let _keepTodoText: string = TodoText.interopBanner();
		let todosState: [ Todo[], import('react').Dispatch<import('react').SetStateAction<Todo[]>> ] = useState<Todo[]>([]);
		let todos: Todo[] = (todosState[0] ?? null);
		let titleState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		let title: string = (titleState[0] ?? null);
		let errorState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		let error: string = (errorState[0] ?? null);
		useEffect(function () {
			Client.listTodos().then(function (next: Todo[]) {
				let setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
				setter(next);
			})["catch"](function (_) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Failed to load todos");
			});
		}, []);
		let replaceTodo: ((updated: Todo) => void) = function (updated: Todo) {
			let _g: Todo[] = [];
			let _g1: number = 0;
			while (_g1 < todos.length) {
				let t: Todo = todos[_g1];
				++_g1;
				_g.push((t.id == updated.id) ? updated : t);
			};
			let next: Todo[] = _g;
			let setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
			setter(next);
		};
		let removeTodo: ((id: string) => void) = function (id: string) {
			let _g: Todo[] = [];
			let _g1: number = 0;
			while (_g1 < todos.length) {
				let t: Todo = todos[_g1];
				++_g1;
				if (t.id != id) {
					_g.push(t);
				};
			};
			let next: Todo[] = _g;
			let setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
			setter(next);
		};
		let onAdd: (() => void) = function () {
			let trimmed: string = StringTools.trim(title);
			if (trimmed.length == 0) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Title is required");
				return;
			};
			let setter: ((arg0: string) => void) = (errorState[1] ?? null);
			setter("");
			Client.createTodo(trimmed).then(function (todo: Todo) {
				let next: Todo[] = todos.concat([todo]);
				let setter: ((arg0: Todo[]) => void) = (todosState[1] ?? null);
				setter(next);
				let setter1: ((arg0: string) => void) = (titleState[1] ?? null);
				setter1("");
			})["catch"](function (_) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Failed to create todo");
			});
		};
		let errorView: ReactChild = (error != "") ? React__genes_jsx.createElement("p", ({style: {"color": "crimson"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"p"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), error) : Register.unsafeCast<ReactChild>(null);
		let renderTodoTitle: ((todo: Todo) => ReactChild) = function (todo: Todo) {
			if (todo.completed) {
				return React__genes_jsx.createElement("s", null, todo.title);
			} else {
				return todo.title;
			};
		};
		let renderTodoItem: ((todo: Todo) => ReactElement) = function (todo: Todo) {
			return React__genes_jsx.createElement("li", ({key: todo.id, style: {"display": "flex", "alignItems": "center", "gap": "8px", "padding": "8px 0", "borderBottom": "1px solid #eee"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"li"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), React__genes_jsx.createElement("input", ({type: "checkbox", checked: todo.completed, onChange: function () {
				return Client.updateTodo(todo.id, {"completed": !todo.completed}).then(function (updated: Todo) {
					replaceTodo(updated);
					return null;
				});
			}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"input"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))), React__genes_jsx.createElement(Link, ({to: "/todos/" + todo.id, style: {"flex": "1"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Link> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), renderTodoTitle(todo)), React__genes_jsx.createElement("button", ({onClick: function () {
				return Client.deleteTodo(todo.id).then(function (_: boolean) {
					removeTodo(todo.id);
					return null;
				});
			}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), " Delete "));
		};
		let tmp: JSX.Element = React__genes_jsx.createElement("h2", null, "Todos");
		let tmp1: JSX.Element = React__genes_jsx.createElement("input", ({value: title, placeholder: "New todo", onChange: function (e: ChangeEvent) {
			let setter: ((arg0: string) => void) = (titleState[1] ?? null);
			setter(e.target.value);
		}, style: {"flex": "1", "padding": "8px"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"input"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let tmp2: JSX.Element = React__genes_jsx.createElement(TodoListPage.PrettyButton, ({label: "Add", onClick: function () {
			onAdd();
		}, variant: "primary"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof TodoListPage.PrettyButton> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let tmp3: JSX.Element = React__genes_jsx.createElement("div", ({style: {"display": "flex", "gap": "8px", "marginBottom": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp1, tmp2);
		let f: ((arg0: Todo) => ReactElement) = renderTodoItem;
		let result: ReactElement[] = new Array(todos.length);
		let _g: number = 0;
		let _g1: number = todos.length;
		while (_g < _g1) {
			let i: number = _g++;
			result[i] = f(todos[i]);
		};
		let tmp4: JSX.Element = React__genes_jsx.createElement("ul", ({style: {"listStyle": "none", "padding": "0", "margin": "0"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"ul"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), result);
		let tmp5: string = TodoListPage.interopBanner();
		return React__genes_jsx.createElement("div", null, tmp, errorView, tmp3, tmp4, React__genes_jsx.createElement("p", ({style: {"marginTop": "16px", "color": "#666", "fontSize": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"p"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp5));
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
