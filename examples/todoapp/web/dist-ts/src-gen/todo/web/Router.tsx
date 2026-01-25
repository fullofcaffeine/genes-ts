import {ReactRouterDom_Fields_} from "../extern/ReactRouterDom"
import type {Params} from "../extern/ReactRouterDom"
import {useParams} from "react-router-dom"
import {Register} from "../../genes/Register"

export class Router {
	static param(name: string): string | null {
		let params: Params = useParams();
		return (params[name] ?? null);
	}
	static get __name__(): string {
		return "todo.web.Router"
	}
	get __class__(): Function {
		return Router
	}
}
Register.setHxClass("todo.web.Router", Router);
