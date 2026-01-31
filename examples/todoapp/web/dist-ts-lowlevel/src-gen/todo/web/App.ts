import * as React__genes_jsx from "react"
import {TodoListPage} from "./pages/TodoListPage"
import {TodoDetailPage} from "./pages/TodoDetailPage"
import type {ReactElement, ReactComponent} from "./ReactTypes"
import {Link, Route, Routes, BrowserRouter} from "react-router-dom"
import {Register} from "../../genes/Register"

export class App {
	static Component(): ReactElement {
		let TodoListComponent: ReactComponent = TodoListPage.Component;
		let TodoDetailComponent: ReactComponent = TodoDetailPage.Component;
		let tmp: JSX.Element = React__genes_jsx.createElement("h1", ({style: {"margin": "0"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"h1"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Todoapp");
		let tmp1: JSX.Element = React__genes_jsx.createElement("nav", null, React__genes_jsx.createElement(Link, ({to: "/", style: {"textDecoration": "none"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Link> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Home"));
		let tmp2: JSX.Element = React__genes_jsx.createElement("header", ({style: {"display": "flex", "justifyContent": "space-between", "alignItems": "center"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"header"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp, tmp1);
		let tmp3: JSX.Element = React__genes_jsx.createElement("hr", null);
		let tmp4: JSX.Element = React__genes_jsx.createElement(TodoListComponent, null);
		let tmp5: JSX.Element = React__genes_jsx.createElement(Route, ({path: "/", element: tmp4} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Route> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let tmp6: JSX.Element = React__genes_jsx.createElement(TodoDetailComponent, null);
		let tmp7: JSX.Element = React__genes_jsx.createElement(Routes, null, tmp5, React__genes_jsx.createElement(Route, ({path: "/todos/:id", element: tmp6} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Route> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))));
		return React__genes_jsx.createElement(BrowserRouter, null, React__genes_jsx.createElement("div", ({style: {"maxWidth": "720px", "margin": "0 auto", "padding": "16px", "fontFamily": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp2, tmp3, tmp7));
	}
	static get __name__(): string {
		return "todo.web.App"
	}
	get __class__(): Function {
		return App
	}
}
Register.setHxClass("todo.web.App", App);
