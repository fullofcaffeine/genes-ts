import type {JSX} from "react"
import * as React__genes_jsx from "react"
import {useState, useEffect} from "react"
import {useNavigate, Link} from "react-router"
import {Router} from "../Router"
import {ReactRouter_Fields_} from "../../extern/ReactRouter"
import {Client} from "../Client"
import {StringTools} from "../../../StringTools"
import {Register} from "../../../genes/Register"
import type {Todo} from "../../shared/Todo"
import type {ChangeEvent} from "../ReactTypes"

function Component(): JSX.Element {
	const idStr: string | null = Router.useParam("id");
	const id: string | null = idStr;
	const [todoState, setTodoState] = useState<Todo | null>(null);
	const todo: Todo | null = todoState;
	const [titleState, setTitleState] = useState<string>("");
	const title: string = titleState;
	const [errorState, setErrorState] = useState<string>("");
	const error: string = errorState;
	const navigate: ((arg0: string) => void) = useNavigate();
	useEffect(function () {
		if (id == null) {
			setErrorState("Missing id");
			return;
		};
		Client.getTodo(id).then(function (t: Todo) {
			setTodoState(t);
			setTitleState(t.title);
		})["catch"](function (_) {
			setErrorState("Todo not found");
		});
	}, [idStr]);
	const onSave: (() => void) = function () {
		if (id == null) {
			return;
		};
		const trimmed: string = StringTools.trim(title);
		if (trimmed.length == 0) {
			setErrorState("Title is required");
			return;
		};
		Client.updateTodoTitle(id, trimmed).then(function (updated: Todo) {
			setTodoState(updated);
			navigate("/");
		})["catch"](function (_) {
			setErrorState("Failed to save");
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
		setTitleState(e.target.value);
	}, style: {"display": "block", "width": "100%", "padding": "8px", "marginTop": "6px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"input"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
	const tmp10: JSX.Element = React__genes_jsx.createElement("label", ({style: {"display": "block", "marginTop": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"label"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), " Title ", tmp9);
	const tmp11: JSX.Element = React__genes_jsx.createElement("button", ({onClick: function () {
		onSave();
	}, style: {"padding": "8px 12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Save");
	const tmp12: JSX.Element = React__genes_jsx.createElement("div", ({style: {"marginTop": "12px"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp11);
	return React__genes_jsx.createElement("div", null, tmp1_1, tmp2, tmp4, tmp6, tmp8, tmp10, tmp12);
}
export class TodoDetailPage {
	static Component(): JSX.Element;
	static Component(): never {
		throw this;
	}
	static get __name__(): string {
		return "todo.web.pages.TodoDetailPage"
	}
	get __class__(): Function {
		return TodoDetailPage
	}
}
TodoDetailPage.Component = Component;
Register.setHxClass("todo.web.pages.TodoDetailPage", TodoDetailPage);
