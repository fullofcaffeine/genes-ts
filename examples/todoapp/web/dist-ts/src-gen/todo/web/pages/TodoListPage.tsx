import type {JSX} from "react"
import __genes_import_PrettyButton from "../../../../src-ts/components/PrettyButton"
import {interopBanner as __genes_import_interopBanner} from "../../../../src-ts/interop/haxeInterop"
import {useState, useEffect} from "react"
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
	const errorView: ReactChild = (error != "") ? <p style={{"color": "crimson"}}>{error}</p> : Register.unsafeCast<ReactChild>(null);
	const renderTodoTitle: ((todo: Todo) => ReactChild) = function (todo: Todo) {
		if (todo.completed) {
			return <s>{todo.title}</s>;
		} else {
			return todo.title;
		};
	};
	const renderTodoItem: ((todo: Todo) => JSX.Element) = function (todo: Todo) {
		return <li key={todo.id} style={{"display": "flex", "alignItems": "center", "gap": "8px", "padding": "8px 0", "borderBottom": "1px solid #eee"}}><input type="checkbox" checked={todo.completed} onChange={function () {
			return Client.updateTodoCompleted(todo.id, !todo.completed).then(function (updated: Todo) {
				replaceTodo(updated);
				return null;
			});
		}} /><Link to={"/todos/" + todo.id} style={{"flex": "1"}}>{renderTodoTitle(todo)}</Link><button onClick={function () {
			return Client.deleteTodo(todo.id).then(function (_: boolean) {
				removeTodo(todo.id);
				return null;
			});
		}}> Delete </button></li>;
	};
	const renderFilterButton: ((label: string, value: TodoFilter) => JSX.Element) = function (label: string, value: TodoFilter) {
		const selected: boolean = filter == value;
		return <button aria-pressed={selected} onClick={function () {
			setFilterState(value);
		}} style={{"padding": "6px 10px", "border": (selected) ? "1px solid #2563eb" : "1px solid #d1d5db", "borderRadius": "999px", "backgroundColor": (selected) ? "#dbeafe" : "white", "color": (selected) ? "#1e3a8a" : "#374151"}}>{label}</button>;
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
	const h2: JSX.Element = <h2>Todos</h2>;
	const input: JSX.Element = <input value={title} placeholder="New todo" onChange={function (e: ChangeEvent) {
		setTitleState(e.target.value);
	}} style={{"flex": "1", "padding": "8px"}} />;
	const tmp2: JSX.Element = <TodoListPage.PrettyButton label="Add" onClick={function () {
		onAdd();
	}} variant="primary" />;
	const div: JSX.Element = <div style={{"display": "flex", "gap": "8px", "marginBottom": "12px"}}>{input}{tmp2}</div>;
	const tmp4: JSX.Element = renderFilterButton("All todos", TodoFilter.All);
	const tmp5: JSX.Element = renderFilterButton("Open todos", TodoFilter.Open);
	const tmp6: JSX.Element = renderFilterButton("Completed todos", TodoFilter.Completed);
	const div_1: JSX.Element = <div style={{"display": "flex", "gap": "8px", "marginBottom": "12px"}}>{tmp4}{tmp5}{tmp6}</div>;
	const f: ((arg0: Todo) => JSX.Element) = renderTodoItem;
	const result: JSX.Element[] = new Array(visibleTodos.length);
	let _g2: number = 0;
	const _g3: number = visibleTodos.length;
	while (_g2 < _g3) {
		const i: number = _g2++;
		result[i] = f(visibleTodos[i]!);
	};
	const ul: JSX.Element = <ul style={{"listStyle": "none", "padding": "0", "margin": "0"}}>{result}</ul>;
	const tmp9: string = TodoListPage.interopBanner();
	return <div>{h2}{errorView}{div}{div_1}{ul}<p style={{"marginTop": "16px", "color": "#666", "fontSize": "12px"}}>{tmp9}</p></div>;
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
