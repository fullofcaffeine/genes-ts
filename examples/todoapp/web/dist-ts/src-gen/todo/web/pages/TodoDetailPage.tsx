import type {JSX} from "react"
import {useState, useEffect} from "react"
import {useNavigate, Link} from "react-router-dom"
import {Router} from "../Router"
import {React_Fields_} from "../../extern/React"
import {ReactRouterDom_Fields_} from "../../extern/ReactRouterDom"
import {Client} from "../Client"
import {StringTools} from "../../../StringTools"
import {Register} from "../../../genes/Register"
import type {Todo} from "../../shared/Todo"
import type {ChangeEvent} from "../ReactTypes"

export class TodoDetailPage {
	static Component(): JSX.Element {
		const idStr: string | null = Router.param("id");
		const id: string | null = (idStr == null) ? null : idStr;
		const todoState: [ Todo | null, import('react').Dispatch<import('react').SetStateAction<Todo | null>> ] = useState<Todo | null>(null);
		const todo: Todo | null = (todoState[0] ?? null);
		const titleState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		const title: string = (titleState[0] ?? null);
		const errorState: [ string, import('react').Dispatch<import('react').SetStateAction<string>> ] = useState<string>("");
		const error: string = (errorState[0] ?? null);
		const navigate: ((arg0: string) => void) = useNavigate();
		useEffect(function () {
			if (id == null) {
				const setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Missing id");
				return;
			};
			Client.getTodo(id).then(function (t: Todo) {
				const setter: ((arg0: Todo | null) => void) = (todoState[1] ?? null);
				setter(t);
				const setter1: ((arg0: string) => void) = (titleState[1] ?? null);
				setter1(t.title);
			})["catch"](function (_) {
				const setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Todo not found");
			});
		}, [idStr]);
		const onSave: (() => void) = function () {
			if (id == null) {
				return;
			};
			const trimmed: string = StringTools.trim(title);
			if (trimmed.length == 0) {
				const setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Title is required");
				return;
			};
			Client.updateTodo(id, {"title": trimmed}).then(function (updated: Todo) {
				const setter: ((arg0: Todo | null) => void) = (todoState[1] ?? null);
				setter(updated);
				navigate("/");
			})["catch"](function (_) {
				const setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Failed to save");
			});
		};
		if (error != "") {
			const p: JSX.Element = <p style={{"color": "crimson"}}>{error}</p>;
			const tmp1: JSX.Element = <Link to="/">Back</Link>;
			return <div>{p}{tmp1}</div>;
		};
		if (todo == null) {
			return <p>Loading...</p>;
		};
		const todoValue: Todo = todo;
		const tmp: JSX.Element = <Link to="/">← Back</Link>;
		const p_1: JSX.Element = <p>{tmp}</p>;
		const h2: JSX.Element = <h2>Todo</h2>;
		const b: JSX.Element = <b>ID:</b>;
		const p_2: JSX.Element = <p>{b}{todoValue.id}</p>;
		const b_1: JSX.Element = <b>Created:</b>;
		const p_3: JSX.Element = <p>{b_1}{todoValue.createdAt}</p>;
		const b_2: JSX.Element = <b>Updated:</b>;
		const p_4: JSX.Element = <p>{b_2}{todoValue.updatedAt}</p>;
		return <div>{p_1}{h2}{p_2}{p_3}{p_4}<label style={{"display": "block", "marginTop": "12px"}}> Title <input value={title} onChange={function (e: ChangeEvent) {
			const setter: ((arg0: string) => void) = (titleState[1] ?? null);
			setter(e.target.value);
		}} style={{"display": "block", "width": "100%", "padding": "8px", "marginTop": "6px"}} /></label><div style={{"marginTop": "12px"}}><button onClick={function () {
			onSave();
		}} style={{"padding": "8px 12px"}}>Save</button></div></div>;
	}
	static get __name__(): string {
		return "todo.web.pages.TodoDetailPage"
	}
	get __class__(): Function {
		return TodoDetailPage
	}
}
Register.setHxClass("todo.web.pages.TodoDetailPage", TodoDetailPage);
