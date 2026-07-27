import {useParams} from "react-router"
import {ReactRouter_Fields_} from "../extern/ReactRouter"
import {Register} from "../../genes/Register"
import type {Params} from "../extern/ReactRouter"

export class Router {
	static param(name: string): string | null {
		const params: Params = useParams();
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
