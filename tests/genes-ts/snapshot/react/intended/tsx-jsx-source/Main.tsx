import type {JSX} from "react"
import {renderToStaticMarkup as __genes_import_renderToStaticMarkup} from "react-dom/server"
import {Exception} from "./haxe/Exception.js"
import {Register} from "./genes/Register.js"
import {createSignal as __genes_import_createSignal, createMemo as __genes_import_createMemo} from "./runtime/signals.js"
import __genes_import_Status from "./components/Status.js"
import __genes_import_Button from "./components/Button.js"

export type StringAccessor = (() => string)

export type StringSignal = {
	get: StringAccessor,
	set: (arg0: string) => void
}

export type CreateMemo = ((arg0: StringAccessor) => StringAccessor)

export type StatusProps = {
	children?: JSX.Element | null,
	label: string,
	value: string
}

export class Main {
	static main(): void {
		let title: string = "Hi";
		let Button: ((arg0: {
			label: string
		}) => JSX.Element) = __genes_import_Button;
		let el: JSX.Element = <span>{2}</span>;
		let el1: JSX.Element = <div className="root" data-test-id="x">{title}{el}</div>;
		let renderToStaticMarkup: ((arg0: JSX.Element) => string) = __genes_import_renderToStaticMarkup;
		let html: string = renderToStaticMarkup(el1);
		if (html != "<div class=\"root\" data-test-id=\"x\">Hi<span>2</span></div>") {
			throw Exception.thrown("Unexpected HTML: " + html);
		};
		let buttonEl: JSX.Element = <Button label="Save" />;
		let buttonHtml: string = renderToStaticMarkup(buttonEl);
		if (buttonHtml != "<button>Save</button>") {
			throw Exception.thrown("Unexpected button HTML: " + buttonHtml);
		};
		let divProps: {
			className: string,
			id: string
		} = {"className": "spread", "id": "x"};
		let divWithSpread: JSX.Element = <div {...divProps}>Z</div>;
		let divWithSpreadHtml: string = renderToStaticMarkup(divWithSpread);
		if (divWithSpreadHtml != "<div class=\"spread\" id=\"x\">Z</div>") {
			throw Exception.thrown("Unexpected spread HTML: " + divWithSpreadHtml);
		};
		let buttonProps: {
			label: string
		} = {"label": "Spread"};
		let buttonSpreadEl: JSX.Element = <Button {...buttonProps} />;
		let buttonSpreadHtml: string = renderToStaticMarkup(buttonSpreadEl);
		if (buttonSpreadHtml != "<button>Spread</button>") {
			throw Exception.thrown("Unexpected spread button HTML: " + buttonSpreadHtml);
		};
		let createSignal: ((arg0: string) => StringSignal) = __genes_import_createSignal;
		let createMemo: CreateMemo = __genes_import_createMemo;
		let Status: ((arg0: StatusProps) => JSX.Element) = __genes_import_Status;
		let count: StringSignal = createSignal("1");
		count.set("2");
		let summary: StringAccessor = createMemo(function () {
			return "items:" + count.get();
		});
		let statusEl: string = summary();
		let statusEl1: JSX.Element = <span>{count.get()}</span>;
		let statusEl2: JSX.Element = <Status label="Count" value={statusEl}>{statusEl1}</Status>;
		let statusHtml: string = renderToStaticMarkup(statusEl2);
		if (statusHtml != "<section data-label=\"Count\"><strong>items:2</strong><span>2</span></section>") {
			throw Exception.thrown("Unexpected status HTML: " + statusHtml);
		};
		let listHtml: string = renderToStaticMarkup(Main.renderChildList("ready", "queued"));
		if (listHtml != "<div><span>ready</span><strong>queued</strong><button>Save</button><em>done</em><span>ready:1</span><strong>queued:2</strong><span>ready:3</span><strong>queued:4</strong><span>ready:5</span><strong>queued:6</strong><span>ready:7</span><strong>queued:8</strong></div>") {
			throw Exception.thrown("Unexpected list HTML: " + listHtml);
		};
		let loweredHtml: string = renderToStaticMarkup(Main.renderLoweredChildList("ready", "queued"));
		if (loweredHtml != "<div><span>ready</span><strong>queued</strong><em>done</em><span>ready:1</span><strong>queued:2</strong></div>") {
			throw Exception.thrown("Unexpected lowered list HTML: " + loweredHtml);
		};
		let frag: JSX.Element = <><span>A</span><span>B</span></>;
		let fragHtml: string = renderToStaticMarkup(frag);
		if (fragHtml != "<span>A</span><span>B</span>") {
			throw Exception.thrown("Unexpected fragment HTML: " + fragHtml);
		};
		let okHandler: (() => void) = function () {
			return;
		};
		let okClick: JSX.Element = <button onClick={okHandler}>Click</button>;
		renderToStaticMarkup(okClick);
		let badHandler: string = "nope";
		// @ts-expect-error;
		let badClick: JSX.Element = <button onClick={badHandler}>Bad</button>;
		renderToStaticMarkup(badClick);
		// @ts-expect-error;
		let badButton: JSX.Element = <Button label={123} />;
		renderToStaticMarkup(badButton);
		// @ts-expect-error;
		let bad: JSX.Element = <div href="nope" />;
		renderToStaticMarkup(bad);
	}
	static renderChildList(first: string, second: string): JSX.Element {
		let Button: ((arg0: {
			label: string
		}) => JSX.Element) = __genes_import_Button;
		return <div><span>{first}</span><strong>{second}</strong><Button label="Save" /><em>done</em><span>{first + ":1"}</span><strong>{second + ":2"}</strong><span>{first + ":3"}</span><strong>{second + ":4"}</strong><span>{first + ":5"}</span><strong>{second + ":6"}</strong><span>{first + ":7"}</span><strong>{second + ":8"}</strong></div>;
	}
	static renderLoweredChildList(first: string, second: string): JSX.Element {
		let span: JSX.Element = <span>{first}</span>;
		let strong: JSX.Element = <strong>{second}</strong>;
		let em: JSX.Element = <em>done</em>;
		let span_1: JSX.Element = <span>{first + ":1"}</span>;
		let strong_1: JSX.Element = <strong>{second + ":2"}</strong>;
		return <div>{span}{strong}{em}{span_1}{strong_1}</div>;
	}
	static get __name__(): string {
		return "Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("Main", Main);
