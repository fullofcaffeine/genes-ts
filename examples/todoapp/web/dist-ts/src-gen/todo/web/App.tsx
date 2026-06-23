import {TodoListPage} from "./pages/TodoListPage"
import {TodoDetailPage} from "./pages/TodoDetailPage"
import type {ReactElement, ReactComponent} from "./ReactTypes"
import {Link, Route, Routes, BrowserRouter} from "react-router-dom"
import {Register} from "../../genes/Register"

export class App {
	static Component(): ReactElement {
		let TodoListComponent: ReactComponent = TodoListPage.Component;
		let TodoDetailComponent: ReactComponent = TodoDetailPage.Component;
		let h1: JSX.Element = <h1 style={{"margin": "0"}}>Todoapp</h1>;
		let nav: JSX.Element = <nav><Link to="/" style={{"textDecoration": "none"}}>Home</Link></nav>;
		let header: JSX.Element = <header style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center"}}>{h1}{nav}</header>;
		let hr: JSX.Element = <hr />;
		let TodoListComponent_1: JSX.Element = <TodoListComponent />;
		let tmp5: JSX.Element = <Route path="/" element={TodoListComponent_1} />;
		let TodoDetailComponent_1: JSX.Element = <TodoDetailComponent />;
		let tmp7: JSX.Element = <Routes>{tmp5}<Route path="/todos/:id" element={TodoDetailComponent_1} /></Routes>;
		return <BrowserRouter><div style={{"maxWidth": "720px", "margin": "0 auto", "padding": "16px", "fontFamily": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}}>{header}{hr}{tmp7}</div></BrowserRouter>;
	}
	static get __name__(): string {
		return "todo.web.App"
	}
	get __class__(): Function {
		return App
	}
}
Register.setHxClass("todo.web.App", App);
