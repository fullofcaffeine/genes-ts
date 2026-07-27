import type {JSX} from "react"
import * as React__genes_jsx from "react"
import {TodoListPage} from "./pages/TodoListPage"
import {TodoDetailPage} from "./pages/TodoDetailPage"
import {Link, Route, Routes, BrowserRouter} from "react-router"
import {Register} from "../../genes/Register"
import type {ReactComponent} from "./ReactTypes"

export class App {
	static Component(): JSX.Element {
		const TodoListComponent: ReactComponent = TodoListPage.Component;
		const TodoDetailComponent: ReactComponent = TodoDetailPage.Component;
		const tmp: JSX.Element = React__genes_jsx.createElement("h1", ({style: {"margin": "0"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"h1"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Todoapp");
		const tmp1: JSX.Element = React__genes_jsx.createElement(Link, ({to: "/", style: {"textDecoration": "none"}, children: "Home"} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof Link> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp2: JSX.Element = React__genes_jsx.createElement("nav", null, tmp1);
		const tmp3: JSX.Element = React__genes_jsx.createElement("header", ({style: {"display": "flex", "justifyContent": "space-between", "alignItems": "center"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"header"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp, tmp2);
		const tmp4: JSX.Element = React__genes_jsx.createElement("hr", null);
		const tmp5: JSX.Element = React__genes_jsx.createElement(Route, ({path: "/", element: React__genes_jsx.createElement(TodoListComponent, null)} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof Route> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp6: JSX.Element = React__genes_jsx.createElement(Route, ({path: "/todos/:id", element: React__genes_jsx.createElement(TodoDetailComponent, null)} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof Route> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp7: JSX.Element = React__genes_jsx.createElement(Routes, ({children: [tmp5, tmp6]} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof Routes> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		const tmp8: JSX.Element = React__genes_jsx.createElement("div", ({style: {"maxWidth": "720px", "margin": "0 auto", "padding": "16px", "fontFamily": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}} satisfies (React__genes_jsx.ComponentPropsWithRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), tmp3, tmp4, tmp7);
		return React__genes_jsx.createElement(BrowserRouter, ({children: tmp8} satisfies (React__genes_jsx.ComponentPropsWithRef<typeof BrowserRouter> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
	}
	static get __name__(): string {
		return "todo.web.App"
	}
	get __class__(): Function {
		return App
	}
}
Register.setHxClass("todo.web.App", App);
