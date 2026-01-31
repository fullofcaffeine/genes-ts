import * as React__genes_jsx from "react"
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
			Client.getTodo(Register.unsafeCast<string>(id)).then(function (t: Todo) {
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
			Client.updateTodo(Register.unsafeCast<string>(id), {"title": trimmed}).then(function (updated: Todo) {
				let setter: ((arg0: Todo | null) => void) = (todoState[1] ?? null);
				setter(updated);
				navigate("/");
			})["catch"](function (_) {
				let setter: ((arg0: string) => void) = (errorState[1] ?? null);
				setter("Failed to save");
			});
		};
		if (error != "") {
			return React__genes_jsx.createElement("div", null, React__genes_jsx.createElement("p", ({style: {"color": "crimson"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"p"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), error), React__genes_jsx.createElement(Link, ({to: "/"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Link> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Back"));
		};
		if (todo == null) {
			return React__genes_jsx.createElement("p", null, "Loading...");
		};
		let todoValue: Todo = todo;
		let tmp: JSX.Element = React__genes_jsx.createElement("p", null, React__genes_jsx.createElement(Link, ({to: "/"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Link> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "← Back"));
		let tmp1: JSX.Element = React__genes_jsx.createElement("h2", null, "Todo");
		let tmp2: JSX.Element = React__genes_jsx.createElement("p", null, React__genes_jsx.createElement("b", null, "ID:"), todoValue.id);
		let tmp3: JSX.Element = React__genes_jsx.createElement("p", null, React__genes_jsx.createElement("b", null, "Created:"), todoValue.createdAt);
		let tmp4: JSX.Element = React__genes_jsx.createElement("p", null, React__genes_jsx.createElement("b", null, "Updated:"), todoValue.updatedAt);
		let tmp5: JSX.Element = React__genes_jsx.createElement("input", ({value: title, onChange: function (e: ChangeEvent) {
			let setter: ((arg0: string) => void) = (titleState[1] ?? null);
			setter(e.target.value);
		}, style: {"display": "block", "width": "100%", "padding": "8px", "marginTop": "6px"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"input"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let tmp6: JSX.Element = React__genes_jsx.createElement("label", ({style: {"display": "block", "marginTop": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"label"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), " Title ", tmp5);
		let tmp7: JSX.Element = React__genes_jsx.createElement("button", ({onClick: function () {
			onSave();
		}, style: {"padding": "8px 12px"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Save");
		return React__genes_jsx.createElement("div", null, tmp, tmp1, tmp2, tmp3, tmp4, tmp6, React__genes_jsx.createElement("div", ({style: {"marginTop": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp7));
	}
	static get __name__(): string {
		return "todo.web.pages.TodoDetailPage"
	}
	get __class__(): Function {
		return TodoDetailPage
	}
}
Register.setHxClass("todo.web.pages.TodoDetailPage", TodoDetailPage);
