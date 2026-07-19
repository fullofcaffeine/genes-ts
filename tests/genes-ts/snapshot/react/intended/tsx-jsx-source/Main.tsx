import type {JSX} from "react"
import __genes_import_Button from "./components/Button.js"
import {renderToStaticMarkup as __genes_import_renderToStaticMarkup} from "react-dom/server"
import {Exception} from "./haxe/Exception.js"
import {createSignal as __genes_import_createSignal, createMemo as __genes_import_createMemo} from "./runtime/signals.js"
import __genes_import_Status from "./components/Status.js"
import {Register} from "./genes/Register.js"

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

export type RequiredChildProps = {
	children: JSX.Element
}

export type GenericValueProps<T> = {
	render: (arg0: T) => string,
	value: T
}

/**
 * Base properties inherited by an extern component contract.
 */
export interface InheritedBaseProps {
	label: string;
	onSelect: ((arg0: import('react').MouseEvent<HTMLElement>) => void);
}
export const InheritedBaseProps = function() {};
InheritedBaseProps.__isInterface__ = true;

/**
 * Proves that HXX reads inherited fields, not only fields declared here.
 */
export interface InheritedCardProps extends InheritedBaseProps {
	tone: string;
}
export const InheritedCardProps = function() {};
InheritedCardProps.__isInterface__ = true;

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
		let AliasedButton: ((arg0: {
			label: string
		}) => JSX.Element) = Button;
		let aliasHtml: string = renderToStaticMarkup(<AliasedButton label="Alias" />);
		if (aliasHtml != "<button>Alias</button>") {
			throw Exception.thrown("Unexpected alias HTML: " + aliasHtml);
		};
		let TypedButton: import('react').ComponentType<{
			label: string
		}> = __genes_import_Button;
		let typedButtonHtml: string = renderToStaticMarkup(<TypedButton label="Typed" key={1.5} />);
		if (typedButtonHtml != "<button>Typed</button>") {
			throw Exception.thrown("Unexpected typed button HTML: " + typedButtonHtml);
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
		let statusEl = {"__genesJsxPropName": "label", "__genesJsxPropValue": "Count", "__genesJsxPropNext": {"__genesJsxPropName": "value", "__genesJsxPropValue": summary(), "__genesJsxPropNext": {"__genesJsxPropsEnd": true}}};
		let statusEl1: string = count.get();
		let statusEl2: JSX.Element = <Status label={statusEl.__genesJsxPropValue} value={statusEl.__genesJsxPropNext.__genesJsxPropValue}><span>{statusEl1}</span></Status>;
		let statusHtml: string = renderToStaticMarkup(statusEl2);
		if (statusHtml != "<section data-label=\"Count\"><strong>items:2</strong><span>2</span></section>") {
			throw Exception.thrown("Unexpected status HTML: " + statusHtml);
		};
		let GenericInt: ((arg0: GenericValueProps<number>) => JSX.Element) = Main.GenericValue;
		let genericHtml: string = renderToStaticMarkup(<GenericInt value={7} render={function (value: number) {
			return "n:" + value;
		}} />);
		if (genericHtml != "<span>n:7</span>") {
			throw Exception.thrown("Unexpected generic HTML: " + genericHtml);
		};
		let inheritedHtml: string = renderToStaticMarkup(<Main.InheritedCard label="Inherited" tone="warm" onSelect={function (event: import('react').MouseEvent<HTMLElement>) {
			event.preventDefault();
		}} />);
		if (inheritedHtml != "<aside data-tone=\"warm\">Inherited</aside>") {
			throw Exception.thrown("Unexpected inherited component HTML: " + inheritedHtml);
		};
		let requiredChildHtml: JSX.Element = <strong>required</strong>;
		let requiredChildHtml1: string = renderToStaticMarkup(<Main.RequiredChild>{requiredChildHtml}</Main.RequiredChild>);
		if (requiredChildHtml1 != "<section><strong>required</strong></section>") {
			throw Exception.thrown("Unexpected required child HTML: " + requiredChildHtml1);
		};
		let booleanAndArrayHtml: string = renderToStaticMarkup(<button disabled aria-pressed>{["A", "B"]}</button>);
		if (booleanAndArrayHtml != "<button disabled=\"\" aria-pressed=\"true\">AB</button>") {
			throw Exception.thrown("Unexpected boolean/array HTML: " + booleanAndArrayHtml);
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
		let contextualClick: JSX.Element = <button onClick={function (event: import('react').MouseEvent<HTMLElement>) {
			event.preventDefault();
		}}>Contextual</button>;
		renderToStaticMarkup(contextualClick);
		let contextualInput: JSX.Element = <input onChange={function (event: import('react').ChangeEvent<HTMLInputElement>) {
			console.log("tests/genes-ts/snapshot/react/src/Main.hx:141:",event.target.value);
		}} />;
		renderToStaticMarkup(contextualInput);
		let okHandler: (() => void) = function () {
			return;
		};
		let okClick: JSX.Element = <button onClick={okHandler}>Click</button>;
		renderToStaticMarkup(okClick);
		let ignoredEvent: JSX.Element = <button onClick={function () {
			return "ignored";
		}}>Ignored</button>;
		renderToStaticMarkup(ignoredEvent);
	}
	static renderChildList(first: string, second: string): JSX.Element {
		let Button: ((arg0: {
			label: string
		}) => JSX.Element) = __genes_import_Button;
		let span: JSX.Element = <span>{first}</span>;
		let strong: JSX.Element = <strong>{second}</strong>;
		let Button_1: JSX.Element = <Button label="Save" />;
		let em: JSX.Element = <em>done</em>;
		let span_1: JSX.Element = <span>{first + ":1"}</span>;
		let strong_1: JSX.Element = <strong>{second + ":2"}</strong>;
		let span_2: JSX.Element = <span>{first + ":3"}</span>;
		let strong_2: JSX.Element = <strong>{second + ":4"}</strong>;
		let span_3: JSX.Element = <span>{first + ":5"}</span>;
		let strong_3: JSX.Element = <strong>{second + ":6"}</strong>;
		let span_4: JSX.Element = <span>{first + ":7"}</span>;
		let strong_4: JSX.Element = <strong>{second + ":8"}</strong>;
		return <div>{span}{strong}{Button_1}{em}{span_1}{strong_1}{span_2}{strong_2}{span_3}{strong_3}{span_4}{strong_4}</div>;
	}
	static GenericValue<T>(props: GenericValueProps<T>): JSX.Element {
		let tmp: string = props.render(props.value);
		return <span>{tmp}</span>;
	}
	static InheritedCard(props: InheritedCardProps): JSX.Element {
		return <aside data-tone={props.tone} onClick={props.onSelect}>{props.label}</aside>;
	}
	static RequiredChild(props: RequiredChildProps): JSX.Element {
		return <section>{props.children}</section>;
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
