import type {JSX} from "react"
import * as React__genes_jsx from "react"
import {useState, useEffect} from "react"
import __genes_import_PrettyButton from "../../../../src-ts/components/PrettyButton"
import {interopBanner as __genes_import_interopBanner} from "../../../../src-ts/interop/haxeInterop"
import {TodoText} from "../../shared/TodoText"
import {TodoFilter} from "../TodoFilter"
import {Client} from "../Client"
import {StringTools} from "../../../StringTools"
import {Link} from "react-router"
import {Register} from "../../../genes/Register"
import type {Todo} from "../../shared/Todo"
import type {ReactComponent1, ReactChild, ChangeEvent} from "../ReactTypes"

function Component(): JSX.Element {
	const _keepTodoText: string = TodoText.interopBanner();
	const [todosState, setTodosState] = useState<Todo[]>([]);
	const todos: Todo[] = todosState;
	const [titleState, setTitleState] = useState<string>("");
	const title: string = titleState;
	const initialFilter: (() => TodoFilter) = function () {
		return TodoFilter.All;
	};
	const [filterState, setFilterState] = useState<TodoFilter>(initialFilter);
	const filter: TodoFilter = filterState;
	const [errorState, setErrorState] = useState<string>("");
	const error: string = errorState;
	useEffect(function () {
		Client.listTodos().then(function (next: Todo[]) {
			setTodosState(next);
		})["catch"](function (_) {
			setErrorState("Failed to load todos");
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
		setTodosState(next);
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
		setTodosState(next);
	};
	const isVisible: ((todo: Todo) => boolean) = function (todo: Todo) {
		switch (filter._hx_index) {
			case 0: {
				return true;
				break;
			}
			case 1: {
				return !todo.completed;
				break;
			}
			case 2: {
				return todo.completed;
				break;
			}
			default: {
				throw "unreachable";
			}
		};
	};
	const onAdd: (() => void) = function () {
		const trimmed: string = StringTools.trim(title);
		if (trimmed.length == 0) {
			setErrorState("Title is required");
			return;
		};
		setErrorState("");
		Client.createTodo(trimmed).then(function (todo: Todo) {
			const next: Todo[] = todos.concat([todo]);
			setTodosState(next);
			setTitleState("");
		})["catch"](function (_) {
			setErrorState("Failed to create todo");
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
			return Client.updateTodoCompleted(todo.id, !todo.completed).then(function (updated: Todo) {
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
	const renderFilterButton: ((label: string, value: TodoFilter) => JSX.Element) = function (label: string, value: TodoFilter) {
		const selected: boolean = filter == value;
		return React__genes_jsx.createElement("button", ({"aria-pressed": selected, onClick: function () {
			setFilterState(value);
		}, style: {"padding": "6px 10px", "border": (selected) ? "1px solid #2563eb" : "1px solid #d1d5db", "borderRadius": "999px", "backgroundColor": (selected) ? "#dbeafe" : "white", "color": (selected) ? "#1e3a8a" : "#374151"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), label);
	};
	const _g_2: Todo[] = [];
	let _g1_2: number = 0;
	while (_g1_2 < todos.length) {
		const todo: Todo = todos[_g1_2]!;
		++_g1_2;
		if (isVisible(todo)) {
			_g_2.push(todo);
		};
	};
	const visibleTodos: Todo[] = _g_2;
	const tmp: JSX.Element = React__genes_jsx.createElement("h2", null, "Todos");
	const tmp1: JSX.Element = React__genes_jsx.createElement("input", ({value: title, placeholder: "New todo", onChange: function (e: ChangeEvent) {
		setTitleState(e.target.value);
	}, style: {"flex": "1", "padding": "8px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"input"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
	const tmp2: JSX.Element = React__genes_jsx.createElement(TodoListPage.PrettyButton, ({label: "Add", onClick: function () {
		onAdd();
	}, variant: "primary"} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof TodoListPage.PrettyButton> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
	const tmp3: JSX.Element = React__genes_jsx.createElement("div", ({style: {"display": "flex", "gap": "8px", "marginBottom": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp1, tmp2);
	const tmp4: JSX.Element = renderFilterButton("All todos", TodoFilter.All);
	const tmp5: JSX.Element = renderFilterButton("Open todos", TodoFilter.Open);
	const tmp6: JSX.Element = renderFilterButton("Completed todos", TodoFilter.Completed);
	const tmp7: JSX.Element = React__genes_jsx.createElement("div", ({style: {"display": "flex", "gap": "8px", "marginBottom": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp4, tmp5, tmp6);
	const f: ((arg0: Todo) => JSX.Element) = renderTodoItem;
	const result: JSX.Element[] = new Array(visibleTodos.length);
	let _g2: number = 0;
	const _g3: number = visibleTodos.length;
	while (_g2 < _g3) {
		const i: number = _g2++;
		result[i] = f(visibleTodos[i]!);
	};
	const tmp8: JSX.Element = React__genes_jsx.createElement("ul", ({style: {"listStyle": "none", "padding": "0", "margin": "0"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"ul"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), result);
	const tmp9: string = TodoListPage.interopBanner();
	const tmp10: JSX.Element = React__genes_jsx.createElement("p", ({style: {"marginTop": "16px", "color": "#666", "fontSize": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"p"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp9);
	return React__genes_jsx.createElement("div", null, tmp, errorView, tmp3, tmp7, tmp8, tmp10);
}
export class TodoListPage {
	declare static PrettyButton: ReactComponent1<PrettyButtonProps>;
	declare static interopBanner: (() => string);
	static Component(): JSX.Element;
	static Component(): never {
		throw this;
	}
	static get __name__(): string {
		return "todo.web.pages.TodoListPage"
	}
	get __class__(): Function {
		return TodoListPage
	}
}
TodoListPage.Component = Component;
Register.setHxClass("todo.web.pages.TodoListPage", TodoListPage);


TodoListPage.PrettyButton = __genes_import_PrettyButton
TodoListPage.interopBanner = __genes_import_interopBanner
export type PrettyButtonProps = {
	label: string,
	onClick: () => void,
	variant?: 'primary' | 'danger' | null
}
