import {Router} from "../Router"
import type {ReactElement, ChangeEvent} from "../ReactTypes"
import {Client} from "../Client"
import type {Todo} from "../../shared/Todo"
import {ReactRouterDom_Fields_} from "../../extern/ReactRouterDom"
import {React_Fields_} from "../../extern/React"
import {useNavigate, Link} from "react-router-dom"
import {useState, useEffect} from "react"
import {Register} from "../../../genes/Register"
import {StringTools} from "../../../StringTools"

export class TodoDetailPage {
	static Component(): ReactElement {
		let idStr: string | null = Router.param("id");
		let id: string | null = (idStr == null) ? null : idStr;
		let todoState: [ Todo | null, import('react').Dispatch<import('react').SetStateAction<Todo | null>> ] = useState<Todo | null>(null);
		let todo: Todo | null = (todoState[0] ?? null);
		let titleState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		let title: string = (titleState[0] ?? null);
		let errorState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		let error: string = (errorState[0] ?? null);
		let navigate: ((arg0: string) => void) = useNavigate();
		useEffect(function () {
			if (id == null) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Missing id");
				return;
			};
			Client.getTodo(id).then(function (t: Todo) {
				let setter: ((arg0: Todo | null) => void) = (todoState[1] ?? null);
				setter(t);
				let setter1: ((arg0: string) => void) = (titleState[1] ?? null);
				setter1(t.title);
			})["catch"](function (_) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Todo not found");
			});
		}, [idStr]);
		let onSave: (() => void) = function () {
			if (id == null) {
				return;
			};
			let trimmed: string = StringTools.trim(title);
			if (trimmed.length == 0) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Title is required");
				return;
			};
			Client.updateTodo(id, {"title": trimmed}).then(function (updated: Todo) {
				let setter: ((arg0: Todo | null) => void) = (todoState[1] ?? null);
				setter(updated);
				navigate("/");
			})["catch"](function (_) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Failed to save");
			});
		};
		if (error != "") {
			return <div><p style={{"color": "crimson"}}>{error}</p><Link to="/">Back</Link></div>;
		};
		if (todo == null) {
			return <p>Loading...</p>;
		};
		let todoValue: Todo = todo;
		let p: JSX.Element = <p><Link to="/">← Back</Link></p>;
		let h2: JSX.Element = <h2>Todo</h2>;
		let p_1: JSX.Element = <p><b>ID:</b>{todoValue.id}</p>;
		let p_2: JSX.Element = <p><b>Created:</b>{todoValue.createdAt}</p>;
		let p_3: JSX.Element = <p><b>Updated:</b>{todoValue.updatedAt}</p>;
		let input: JSX.Element = <input value={title} onChange={function (e: ChangeEvent) {
			let setter: ((arg0: string) => void) = (titleState[1] ?? null);
			setter(e.target.value);
		}} style={{"display": "block", "width": "100%", "padding": "8px", "marginTop": "6px"}} />;
		let label: JSX.Element = <label style={{"display": "block", "marginTop": "12px"}}> Title {input}</label>;
		let button: JSX.Element = <button onClick={function () {
			onSave();
		}} style={{"padding": "8px 12px"}}>Save</button>;
		return <div>{p}{h2}{p_1}{p_2}{p_3}{label}<div style={{"marginTop": "12px"}}>{button}</div></div>;
	}
	static get __name__(): string {
		return "todo.web.pages.TodoDetailPage"
	}
	get __class__(): Function {
		return TodoDetailPage
	}
}
Register.setHxClass("todo.web.pages.TodoDetailPage", TodoDetailPage);
