import {useParams} from "react-router"
import {ReactRouter_Fields_} from "../extern/ReactRouter"
import {Register} from "../../genes/Register"
import type {Params} from "../extern/ReactRouter"

function useParam(name: string): string | null {
	const params: Params = useParams();
	return (params[name] ?? null);
}
export class Router {
	static useParam(name: string): string | null;
	static useParam(): never {
		throw this;
	}
	static get __name__(): string {
		return "todo.web.Router"
	}
	get __class__(): Function {
		return Router
	}
}
Router.useParam = useParam;
