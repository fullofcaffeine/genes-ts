import type {JSX} from "react"
import __genes_import_PrettyButton from "../../../../src-ts/components/PrettyButton"
import {interopBanner as __genes_import_interopBanner} from "../../../../src-ts/interop/haxeInterop"
import {useState, useEffect} from "react"
import {TodoText} from "../../shared/TodoText"
import {Client} from "../Client"
import {StringTools} from "../../../StringTools"
import {Link} from "react-router"
import {Register} from "../../../genes/Register"
import type {ReactComponent1, ReactChild, ChangeEvent} from "../ReactTypes"
import type {UseStateResult} from "../../../genes/react/UseStateResult"
import type {Todo} from "../../shared/Todo"

function Component(): JSX.Element {
	const _keepTodoText: string = TodoText.interopBanner();
	const todosState = useState<Todo[]>([]);
	const todos: Todo[] = todosState[0];
	const titleState: UseStateResult<string> = useState("");
	const title: string = titleState[0];
	const errorState: UseStateResult<string> = useState("");
	const error: string = errorState[0];
	useEffect(function () {
		Client.listTodos().then(function (next: Todo[]) {
			todosState[1](next);
		})["catch"](function (_) {
			errorState[1]("Failed to load todos");
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
		todosState[1](next);
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
		todosState[1](next);
	};
	const onAdd: (() => void) = function () {
		const trimmed: string = StringTools.trim(title);
		if (trimmed.length == 0) {
			errorState[1]("Title is required");
			return;
		};
		errorState[1]("");
		Client.createTodo(trimmed).then(function (todo: Todo) {
			const next: Todo[] = todos.concat([todo]);
			todosState[1](next);
			titleState[1]("");
		})["catch"](function (_) {
			errorState[1]("Failed to create todo");
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
			return Client.updateTodo(todo.id, {"completed": !todo.completed}).then(function (updated: Todo) {
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
	const h2: JSX.Element = <h2>Todos</h2>;
	const input: JSX.Element = <input value={title} placeholder="New todo" onChange={function (e: ChangeEvent) {
		titleState[1](e.target.value);
	}} style={{"flex": "1", "padding": "8px"}} />;
	const tmp2: JSX.Element = <TodoListPage.PrettyButton label="Add" onClick={function () {
		onAdd();
	}} variant="primary" />;
	const div: JSX.Element = <div style={{"display": "flex", "gap": "8px", "marginBottom": "12px"}}>{input}{tmp2}</div>;
	const f: ((arg0: Todo) => JSX.Element) = renderTodoItem;
	const result: JSX.Element[] = new Array(todos.length);
	let _g_2: number = 0;
	const _g1_2: number = todos.length;
	while (_g_2 < _g1_2) {
		const i: number = _g_2++;
		result[i] = f(todos[i]!);
	};
	const ul: JSX.Element = <ul style={{"listStyle": "none", "padding": "0", "margin": "0"}}>{result}</ul>;
	const tmp5: string = TodoListPage.interopBanner();
	return <div>{h2}{errorView}{div}{ul}<p style={{"marginTop": "16px", "color": "#666", "fontSize": "12px"}}>{tmp5}</p></div>;
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

TodoListPage.PrettyButton = __genes_import_PrettyButton
TodoListPage.interopBanner = __genes_import_interopBanner
export type PrettyButtonProps = {
	label: string,
	onClick: () => void,
	variant?: 'primary' | 'danger' | null
}
