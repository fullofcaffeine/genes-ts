import * as React__genes_jsx from "react"
import type {ReactComponent} from "./ReactTypes"
import {App} from "./App"
import * as ReactDomClient from "react-dom/client"
import {Exception} from "../../haxe/Exception"
import {Register} from "../../genes/Register"

export class Main {
	static main(): void {
		let el: HTMLElement | null = window.document.getElementById("root");
		if (el == null) {
			throw Exception.thrown("Missing #root");
		};
		let AppComponent: ReactComponent = App.Component;
		ReactDomClient.createRoot(Register.unsafeCast<HTMLElement>(el)).render(React__genes_jsx.createElement(AppComponent, null));
	}
	static get __name__(): string {
		return "todo.web.Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("todo.web.Main", Main);
