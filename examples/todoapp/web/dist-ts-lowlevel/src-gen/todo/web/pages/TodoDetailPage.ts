import type {JSX} from "react"
import * as React__genes_jsx from "react"
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
			const tmp: JSX.Element = React__genes_jsx.createElement("p", ({style: {"color": "crimson"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"p"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), error);
			const tmp1: JSX.Element = React__genes_jsx.createElement(Link, ({to: "/", children: "Back"} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof Link> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
			return React__genes_jsx.createElement("div", null, tmp, tmp1);
		};
		if (todo == null) {
			return React__genes_jsx.createElement("p", null, "Loading...");
		};
		const todoValue: Todo = todo;
		const tmp_1: JSX.Element = React__genes_jsx.createElement(Link, ({to: "/", children: "← Back"} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof Link> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp1_1: JSX.Element = React__genes_jsx.createElement("p", null, tmp_1);
		const tmp2: JSX.Element = React__genes_jsx.createElement("h2", null, "Todo");
		const tmp3: JSX.Element = React__genes_jsx.createElement("b", null, "ID:");
		const tmp4: JSX.Element = React__genes_jsx.createElement("p", null, tmp3, todoValue.id);
		const tmp5: JSX.Element = React__genes_jsx.createElement("b", null, "Created:");
		const tmp6: JSX.Element = React__genes_jsx.createElement("p", null, tmp5, todoValue.createdAt);
		const tmp7: JSX.Element = React__genes_jsx.createElement("b", null, "Updated:");
		const tmp8: JSX.Element = React__genes_jsx.createElement("p", null, tmp7, todoValue.updatedAt);
		const tmp9: JSX.Element = React__genes_jsx.createElement("input", ({value: title, onChange: function (e: ChangeEvent) {
			const setter: ((arg0: string) => void) = (titleState[1] ?? null);
			setter(e.target.value);
		}, style: {"display": "block", "width": "100%", "padding": "8px", "marginTop": "6px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"input"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp10: JSX.Element = React__genes_jsx.createElement("label", ({style: {"display": "block", "marginTop": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"label"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), " Title ", tmp9);
		const tmp11: JSX.Element = React__genes_jsx.createElement("button", ({onClick: function () {
			onSave();
		}, style: {"padding": "8px 12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Save");
		const tmp12: JSX.Element = React__genes_jsx.createElement("div", ({style: {"marginTop": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp11);
		return React__genes_jsx.createElement("div", null, tmp1_1, tmp2, tmp4, tmp6, tmp8, tmp10, tmp12);
	}
	static get __name__(): string {
		return "todo.web.pages.TodoDetailPage"
	}
	get __class__(): Function {
		return TodoDetailPage
	}
}
Register.setHxClass("todo.web.pages.TodoDetailPage", TodoDetailPage);
