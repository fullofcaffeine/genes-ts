import type {JSX} from "react"
import {Exception} from "../../haxe/Exception"
import {App} from "./App"
import * as ReactDomClient from "react-dom/client"
import {Register} from "../../genes/Register"
import type {ReactComponent} from "./ReactTypes"

export class Main {
	static main(): void {
		let el: HTMLElement | null = window.document.getElementById("root");
		if (el == null) {
			throw Exception.thrown("Missing #root");
		};
		let AppComponent: ReactComponent = App.Component;
		ReactDomClient.createRoot(el).render(<AppComponent />);
	}
	static get __name__(): string {
		return "todo.web.Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("todo.web.Main", Main);
