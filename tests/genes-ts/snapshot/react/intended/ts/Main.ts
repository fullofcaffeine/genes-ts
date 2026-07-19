import * as React__genes_jsx from "react"
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
		let el: JSX.Element = React__genes_jsx.createElement("span", null, 2);
		let el1: JSX.Element = React__genes_jsx.createElement("div", ({className: "root", "data-test-id": "x"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), title, el);
		let renderToStaticMarkup: ((arg0: JSX.Element) => string) = __genes_import_renderToStaticMarkup;
		let html: string = renderToStaticMarkup(el1);
		if (html != "<div class=\"root\" data-test-id=\"x\">Hi<span>2</span></div>") {
			throw Exception.thrown("Unexpected HTML: " + html);
		};
		let buttonEl: JSX.Element = React__genes_jsx.createElement(Button, ({label: "Save"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Button> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let buttonHtml: string = renderToStaticMarkup(buttonEl);
		if (buttonHtml != "<button>Save</button>") {
			throw Exception.thrown("Unexpected button HTML: " + buttonHtml);
		};
		let AliasedButton: ((arg0: {
			label: string
		}) => JSX.Element) = Button;
		let aliasHtml: string = renderToStaticMarkup(React__genes_jsx.createElement(AliasedButton, ({label: "Alias"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof AliasedButton> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))));
		if (aliasHtml != "<button>Alias</button>") {
			throw Exception.thrown("Unexpected alias HTML: " + aliasHtml);
		};
		let TypedButton: import('react').ComponentType<{
			label: string
		}> = __genes_import_Button;
		let typedButtonHtml: string = renderToStaticMarkup(React__genes_jsx.createElement(TypedButton, ({label: "Typed", key: 1.5} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof TypedButton> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))));
		if (typedButtonHtml != "<button>Typed</button>") {
			throw Exception.thrown("Unexpected typed button HTML: " + typedButtonHtml);
		};
		let divProps: {
			className: string,
			id: string
		} = {"className": "spread", "id": "x"};
		let divWithSpread: JSX.Element = React__genes_jsx.createElement("div", ({...divProps} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Z");
		let divWithSpreadHtml: string = renderToStaticMarkup(divWithSpread);
		if (divWithSpreadHtml != "<div class=\"spread\" id=\"x\">Z</div>") {
			throw Exception.thrown("Unexpected spread HTML: " + divWithSpreadHtml);
		};
		let buttonProps: {
			label: string
		} = {"label": "Spread"};
		let buttonSpreadEl: JSX.Element = React__genes_jsx.createElement(Button, ({...buttonProps} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Button> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
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
		let statusEl2: JSX.Element = React__genes_jsx.createElement(Status, ({label: statusEl.__genesJsxPropValue, value: statusEl.__genesJsxPropNext.__genesJsxPropValue} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Status> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), React__genes_jsx.createElement("span", null, statusEl1));
		let statusHtml: string = renderToStaticMarkup(statusEl2);
		if (statusHtml != "<section data-label=\"Count\"><strong>items:2</strong><span>2</span></section>") {
			throw Exception.thrown("Unexpected status HTML: " + statusHtml);
		};
		let GenericInt: ((arg0: GenericValueProps<number>) => JSX.Element) = Main.GenericValue;
		let genericHtml: string = renderToStaticMarkup(React__genes_jsx.createElement(GenericInt, ({value: 7, render: function (value: number) {
			return "n:" + value;
		}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof GenericInt> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))));
		if (genericHtml != "<span>n:7</span>") {
			throw Exception.thrown("Unexpected generic HTML: " + genericHtml);
		};
		let inheritedHtml: string = renderToStaticMarkup(React__genes_jsx.createElement(Main.InheritedCard, ({label: "Inherited", tone: "warm", onSelect: function (event: import('react').MouseEvent<HTMLElement>) {
			event.preventDefault();
		}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Main.InheritedCard> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined }))));
		if (inheritedHtml != "<aside data-tone=\"warm\">Inherited</aside>") {
			throw Exception.thrown("Unexpected inherited component HTML: " + inheritedHtml);
		};
		let requiredChildHtml: JSX.Element = React__genes_jsx.createElement("strong", null, "required");
		let requiredChildHtml1: string = renderToStaticMarkup(React__genes_jsx.createElement(Main.RequiredChild, null, requiredChildHtml));
		if (requiredChildHtml1 != "<section><strong>required</strong></section>") {
			throw Exception.thrown("Unexpected required child HTML: " + requiredChildHtml1);
		};
		let booleanAndArrayHtml: string = renderToStaticMarkup(React__genes_jsx.createElement("button", ({disabled: true, "aria-pressed": true} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), ["A", "B"]));
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
		let frag: JSX.Element = React__genes_jsx.createElement(React__genes_jsx.Fragment, null, React__genes_jsx.createElement("span", null, "A"), React__genes_jsx.createElement("span", null, "B"));
		let fragHtml: string = renderToStaticMarkup(frag);
		if (fragHtml != "<span>A</span><span>B</span>") {
			throw Exception.thrown("Unexpected fragment HTML: " + fragHtml);
		};
		let contextualClick: JSX.Element = React__genes_jsx.createElement("button", ({onClick: function (event: import('react').MouseEvent<HTMLElement>) {
			event.preventDefault();
		}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Contextual");
		renderToStaticMarkup(contextualClick);
		let contextualInput: JSX.Element = React__genes_jsx.createElement("input", ({onChange: function (event: import('react').ChangeEvent<HTMLInputElement>) {
			console.log("tests/genes-ts/snapshot/react/src/Main.hx:141:",event.target.value);
		}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"input"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		renderToStaticMarkup(contextualInput);
		let okHandler: (() => void) = function () {
			return;
		};
		let okClick: JSX.Element = React__genes_jsx.createElement("button", ({onClick: okHandler} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Click");
		renderToStaticMarkup(okClick);
		let ignoredEvent: JSX.Element = React__genes_jsx.createElement("button", ({onClick: function () {
			return "ignored";
		}} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Ignored");
		renderToStaticMarkup(ignoredEvent);
	}
	static renderChildList(first: string, second: string): JSX.Element {
		let Button: ((arg0: {
			label: string
		}) => JSX.Element) = __genes_import_Button;
		let tmp: JSX.Element = React__genes_jsx.createElement("span", null, first);
		let tmp1: JSX.Element = React__genes_jsx.createElement("strong", null, second);
		let tmp2: JSX.Element = React__genes_jsx.createElement(Button, ({label: "Save"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Button> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let tmp3: JSX.Element = React__genes_jsx.createElement("em", null, "done");
		let tmp4: JSX.Element = React__genes_jsx.createElement("span", null, first + ":1");
		let tmp5: JSX.Element = React__genes_jsx.createElement("strong", null, second + ":2");
		let tmp6: JSX.Element = React__genes_jsx.createElement("span", null, first + ":3");
		let tmp7: JSX.Element = React__genes_jsx.createElement("strong", null, second + ":4");
		let tmp8: JSX.Element = React__genes_jsx.createElement("span", null, first + ":5");
		let tmp9: JSX.Element = React__genes_jsx.createElement("strong", null, second + ":6");
		let tmp10: JSX.Element = React__genes_jsx.createElement("span", null, first + ":7");
		let tmp11: JSX.Element = React__genes_jsx.createElement("strong", null, second + ":8");
		return React__genes_jsx.createElement("div", null, tmp, tmp1, tmp2, tmp3, tmp4, tmp5, tmp6, tmp7, tmp8, tmp9, tmp10, tmp11);
	}
	static GenericValue<T>(props: GenericValueProps<T>): JSX.Element {
		let tmp: string = props.render(props.value);
		return React__genes_jsx.createElement("span", null, tmp);
	}
	static InheritedCard(props: InheritedCardProps): JSX.Element {
		return React__genes_jsx.createElement("aside", ({"data-tone": props.tone, onClick: props.onSelect} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"aside"> & React__genes_jsx.Attributes & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), props.label);
	}
	static RequiredChild(props: RequiredChildProps): JSX.Element {
		return React__genes_jsx.createElement("section", null, props.children);
	}
	static renderLoweredChildList(first: string, second: string): JSX.Element {
		let tmp: JSX.Element = React__genes_jsx.createElement("span", null, first);
		let tmp1: JSX.Element = React__genes_jsx.createElement("strong", null, second);
		let tmp2: JSX.Element = React__genes_jsx.createElement("em", null, "done");
		let tmp3: JSX.Element = React__genes_jsx.createElement("span", null, first + ":1");
		let tmp4: JSX.Element = React__genes_jsx.createElement("strong", null, second + ":2");
		return React__genes_jsx.createElement("div", null, tmp, tmp1, tmp2, tmp3, tmp4);
	}
	static get __name__(): string {
		return "Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("Main", Main);
