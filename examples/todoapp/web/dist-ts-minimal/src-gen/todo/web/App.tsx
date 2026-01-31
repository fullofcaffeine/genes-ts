import {TodoListPage} from "./pages/TodoListPage"
import {TodoDetailPage} from "./pages/TodoDetailPage"
import type {ReactElement, ReactComponent} from "./ReactTypes"
import {Link, Route, Routes, BrowserRouter} from "react-router-dom"
import {Register} from "../../genes/Register"

export class App {
	static Component(): ReactElement {
		let TodoListComponent: ReactComponent = TodoListPage.Component;
		let TodoDetailComponent: ReactComponent = TodoDetailPage.Component;
		let tmp: JSX.Element = <h1 style={{"margin": "0"}}>Todoapp</h1>;
		let tmp1: JSX.Element = <nav><Link to="/" style={{"textDecoration": "none"}}>Home</Link></nav>;
		let tmp2: JSX.Element = <header style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center"}}>{tmp}{tmp1}</header>;
		let tmp3: JSX.Element = <hr />;
		let tmp4: JSX.Element = <TodoListComponent />;
		let tmp5: JSX.Element = <Route path="/" element={tmp4} />;
		let tmp6: JSX.Element = <TodoDetailComponent />;
		let tmp7: JSX.Element = <Routes>{tmp5}<Route path="/todos/:id" element={tmp6} /></Routes>;
		return <BrowserRouter><div style={{"maxWidth": "720px", "margin": "0 auto", "padding": "16px", "fontFamily": "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}}>{tmp2}{tmp3}{tmp7}</div></BrowserRouter>;
	}
	static get __name__(): string {
		return "todo.web.App"
	}
	get __class__(): Function {
		return App
	}
}
