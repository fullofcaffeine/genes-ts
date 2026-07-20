import type {JSX} from "react"
import {TodoListPage} from "./pages/TodoListPage"
import {TodoDetailPage} from "./pages/TodoDetailPage"
import {Link, Route, Routes, BrowserRouter} from "react-router-dom"
import {Register} from "../../genes/Register"
import type {ReactComponent} from "./ReactTypes"

export class App {
	static Component(): JSX.Element {
		let TodoListComponent: ReactComponent = TodoListPage.Component;
		let TodoDetailComponent: ReactComponent = TodoDetailPage.Component;
		return <BrowserRouter><div style={{"maxWidth": "720px", "margin": "0 auto", "padding": "16px", "fontFamily": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}}><header style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center"}}><h1 style={{"margin": "0"}}>Todoapp</h1><nav><Link to="/" style={{"textDecoration": "none"}}>Home</Link></nav></header><hr /><Routes><Route path="/" element={<TodoListComponent />} /><Route path="/todos/:id" element={<TodoDetailComponent />} /></Routes></div></BrowserRouter>;
	}
	static get __name__(): string {
		return "todo.web.App"
	}
	get __class__(): Function {
		return App
	}
}
