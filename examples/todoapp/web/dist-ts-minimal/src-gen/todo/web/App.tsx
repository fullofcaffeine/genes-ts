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
		let h1: JSX.Element = <h1 style={{"margin": "0"}}>Todoapp</h1>;
		let tmp1: JSX.Element = <Link to="/" style={{"textDecoration": "none"}}>Home</Link>;
		let header: JSX.Element = <header style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center"}}>{h1}<nav>{tmp1}</nav></header>;
		let hr: JSX.Element = <hr />;
		let tmp5: JSX.Element = <Route path="/" element={<TodoListComponent />} />;
		let tmp6: JSX.Element = <Route path="/todos/:id" element={<TodoDetailComponent />} />;
		let tmp7: JSX.Element = <Routes>{tmp5}{tmp6}</Routes>;
		let div: JSX.Element = <div style={{"maxWidth": "720px", "margin": "0 auto", "padding": "16px", "fontFamily": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}}>{header}{hr}{tmp7}</div>;
		return <BrowserRouter>{div}</BrowserRouter>;
	}
	static get __name__(): string {
		return "todo.web.App"
	}
	get __class__(): Function {
		return App
	}
}
