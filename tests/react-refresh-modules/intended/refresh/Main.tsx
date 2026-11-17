import type {JSX} from "react"
import {LoadLog} from "./LoadLog.js"
import {App_Fields_, App} from "./App.js"
import {Std} from "../Std.js"
import {Holder} from "./Transitive.js"
import {renderOmitted} from "./Omitted.js"
import {CycleDep} from "./CycleDep.js"
import {Cycle_Fields_} from "./Cycle.js"
import {IfaceHolder, CallbackIface_Fields_} from "./CallbackIface.js"
import {SuperHolder, CallbackSuper_Fields_} from "./CallbackSuper.js"
import {StringHolder, CallbackString_Fields_} from "./CallbackString.js"
import * as ReactDomClient from "react-dom/client"
import {Register} from "../genes/Register.js"

/**
 * Mounts `App` in a browser; does nothing in Node.
 */
export class Main {
	static main(): void {
		LoadLog.record("Main:" + App_Fields_.appTitle());
		LoadLog.record("Transitive:" + Std.string(Holder.cached != null));
		LoadLog.record("Omitted:" + Std.string(renderOmitted(2) != null));
		LoadLog.record("Cycle:" + Std.string(CycleDep.rendered != null) + ":" + Cycle_Fields_.cyclePlain());
		LoadLog.record("Callbacks:" + Std.string(IfaceHolder.rendered != null) + ":" + Std.string(SuperHolder.child.element != null) + ":" + StringHolder.text + ":" + (CallbackIface_Fields_.ifaceKeep() + CallbackSuper_Fields_.superKeep() + CallbackString_Fields_.stringKeep()));
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
