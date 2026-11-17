import type {JSX} from "react"
import {LoadLog} from "./LoadLog.js"
import {App_Fields_, App} from "./App.js"
import * as ReactDomClient from "react-dom/client"
import {Register} from "../genes/Register.js"

/**
 * Mounts `App` in a browser; does nothing in Node.
 */
export class Main {
	static main(): void {
		LoadLog.record("Main:" + App_Fields_.appTitle());
		if (typeof document == "undefined") {
			return;
		};
		const container: HTMLElement | null = window.document.getElementById("root");
		if (container != null) {
			ReactDomClient.createRoot(container).render(<App />);
		};
	}
	static get __name__(): string {
		return "refresh.Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("refresh.Main", Main);
