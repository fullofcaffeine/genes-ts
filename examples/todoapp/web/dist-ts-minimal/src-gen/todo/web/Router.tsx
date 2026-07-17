import {useParams} from "react-router-dom"
import {ReactRouterDom_Fields_} from "../extern/ReactRouterDom"
import {Register} from "../../genes/Register"
import type {Params} from "../extern/ReactRouterDom"

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
