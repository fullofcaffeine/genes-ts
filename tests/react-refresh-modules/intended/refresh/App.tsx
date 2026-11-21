import type {JSX} from "react"
import {Panel} from "./Panel.js"
import {Tone, Counter, Panel_Fields_} from "./Panel.fields.js"
import {Std} from "../Std.js"
import {Greeting} from "./Greeting.js"
import {Label, Registry} from "./Unsplit.js"
import {Register} from "../genes/Register.js"
import {App_Fields_, appTitle} from "./App.fields.js"

export function App(): JSX.Element {
	const tone: Tone = Tone.Loud(Counter.next(1));
	const summary: string = Panel_Fields_.formatCount(Counter.next(0)) + " " + Std.string(tone) + " " + Counter.loaded;
	const tmp: JSX.Element = <Greeting name="refresh" />;
	const tmp1: JSX.Element = <Panel title="Fast Refresh" />;
	const tmp2: JSX.Element = Panel_Fields_.badgeFor(7);
	const tmp3: JSX.Element = <Label text="kept" />;
	const tmp4: JSX.Element = Registry.defaultView({"text": "registry"});
	return <main>{tmp}{tmp1}{tmp2}{tmp3}{tmp4}<footer data-summary="">{summary}</footer></main>;
}
App_Fields_.App = App;
