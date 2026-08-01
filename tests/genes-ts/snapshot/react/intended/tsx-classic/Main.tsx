import type {JSX} from "react"
import * as React from "react"
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

export type BroadNodeProps = {
	children: React.ReactNode
}

export type GenericValueProps<T> = {
	render: (arg0: T) => string,
	value: T
}

/**
 * Models target-owned property spellings that are not legal Haxe identifiers.
 *
 * `@:native` keeps author code and component bodies type-safe through
 * `ariaControls` and `onValue`, while HXX and emitted object fields use the
 * external `aria-controls` and `on-value` names.
 */
export type NativeFieldProps = {
	"aria-controls": string,
	key?: import('react').Key | null,
	"on-value": (arg0: string) => void
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

/**
 * Positive React HXX fixture shared by typed TSX and createElement profiles.
 *
 * It proves local, imported, aliased, generic, and inherited component
 * contracts alongside intrinsic props, callbacks, spreads, and children. The
 * harness type-checks and executes the generated output.
 */
export class Main {
	declare static jsxEvaluationOrder: string[];
	static syncFormAction(data: globalThis.FormData): void {
		data.has("title");
	}
	static asyncFormAction(data: globalThis.FormData): globalThis.Promise<void> {
		data.has("title");
		return globalThis.Promise.resolve();
	}
	static main(): void {
		const title: string = "Hi";
		const standardAnchorHandler: ((arg0: import('react').MouseEvent<HTMLAnchorElement>) => void) = function (event: import('react').MouseEvent<HTMLAnchorElement>) {
			event.preventDefault();
		};
		const Button: ((arg0: {
			label: string
		}) => JSX.Element) = __genes_import_Button;
		const el1: JSX.Element = <div className="root" data-test-id="x">{title}<span>{2}</span></div>;
		const renderToStaticMarkup: ((arg0: JSX.Element) => string) = __genes_import_renderToStaticMarkup;
		const html: string = renderToStaticMarkup(el1);
		if (html != "<div class=\"root\" data-test-id=\"x\">Hi<span>2</span></div>") {
			throw Exception.thrown("Unexpected HTML: " + html);
		};
		const buttonEl: JSX.Element = <Button label="Save" />;
		const buttonHtml: string = renderToStaticMarkup(buttonEl);
		if (buttonHtml != "<button>Save</button>") {
			throw Exception.thrown("Unexpected button HTML: " + buttonHtml);
		};
		const AliasedButton: ((arg0: {
			label: string
		}) => JSX.Element) = Button;
		const aliasHtml: string = renderToStaticMarkup(<AliasedButton label="Alias" />);
		if (aliasHtml != "<button>Alias</button>") {
			throw Exception.thrown("Unexpected alias HTML: " + aliasHtml);
		};
		const TypedButton: import('react').ComponentType<{
			label: string
		}> = __genes_import_Button;
		const typedButtonHtml: string = renderToStaticMarkup(<TypedButton label="Typed" key={1.5} />);
		if (typedButtonHtml != "<button>Typed</button>") {
			throw Exception.thrown("Unexpected typed button HTML: " + typedButtonHtml);
		};
		const divProps: {
			className: string,
			id: string
		} = {"className": "spread", "id": "x"};
		const divWithSpread: JSX.Element = <div {...divProps}>Z</div>;
		const divWithSpreadHtml: string = renderToStaticMarkup(divWithSpread);
		if (divWithSpreadHtml != "<div class=\"spread\" id=\"x\">Z</div>") {
			throw Exception.thrown("Unexpected spread HTML: " + divWithSpreadHtml);
		};
		const buttonProps: {
			label: string
		} = {"label": "Spread"};
		const buttonSpreadEl: JSX.Element = <Button {...buttonProps} />;
		const buttonSpreadHtml: string = renderToStaticMarkup(buttonSpreadEl);
		if (buttonSpreadHtml != "<button>Spread</button>") {
			throw Exception.thrown("Unexpected spread button HTML: " + buttonSpreadHtml);
		};
		const createSignal: ((arg0: string) => StringSignal) = __genes_import_createSignal;
		const createMemo: CreateMemo = __genes_import_createMemo;
		const Status: ((arg0: StatusProps) => JSX.Element) = __genes_import_Status;
		const count: StringSignal = createSignal("1");
		count.set("2");
		const summary: StringAccessor = createMemo(function () {
			return "items:" + count.get();
		});
		const statusEl = {"label": "Count", "value": summary()};
		const statusEl1: string = count.get();
		const statusEl2: JSX.Element = <Status label={statusEl.label} value={statusEl.value}><span>{statusEl1}</span></Status>;
		const statusHtml: string = renderToStaticMarkup(statusEl2);
		if (statusHtml != "<section data-label=\"Count\"><strong>items:2</strong><span>2</span></section>") {
			throw Exception.thrown("Unexpected status HTML: " + statusHtml);
		};
		const GenericInt: ((arg0: GenericValueProps<number>) => JSX.Element) = Main.GenericValue;
		const genericHtml: string = renderToStaticMarkup(<GenericInt value={7} render={function (value: number) {
			return "n:" + value;
		}} />);
		if (genericHtml != "<span>n:7</span>") {
			throw Exception.thrown("Unexpected generic HTML: " + genericHtml);
		};
		const directGenericHtml: string = renderToStaticMarkup(<Main.GenericValue value={8} render={function (value: number) {
			return "n:" + value;
		}} />);
		if (directGenericHtml != "<span>n:8</span>") {
			throw Exception.thrown("Unexpected direct generic HTML: " + directGenericHtml);
		};
		const broadHandler: ((arg0: import('react').SyntheticEvent<HTMLElement>) => void) = function (event: import('react').SyntheticEvent<HTMLElement>) {
			event.preventDefault();
		};
		const inheritedHtml: string = renderToStaticMarkup(<Main.InheritedCard label="Inherited" tone="warm" onSelect={broadHandler} />);
		if (inheritedHtml != "<aside data-tone=\"warm\">Inherited</aside>") {
			throw Exception.thrown("Unexpected inherited component HTML: " + inheritedHtml);
		};
		let namedNativeValue: string = "";
		const nativeFieldHtml: string = renderToStaticMarkup(<Main.NativeField key="native-field" aria-controls="named-panel" on-value={function (value: string) {
			namedNativeValue = value;
		}} />);
		if (nativeFieldHtml != "<section aria-controls=\"named-panel\">named-panel</section>") {
			throw Exception.thrown("Unexpected native-field component HTML: " + nativeFieldHtml);
		};
		if (namedNativeValue != "named-panel") {
			throw Exception.thrown("Unexpected native-field callback value: " + namedNativeValue);
		};
		let spreadNativeValue: string = "";
		const nativeFieldProps: NativeFieldProps = {"aria-controls": "spread-panel", "on-value": function (value: string) {
			spreadNativeValue = value;
		}};
		const nativeFieldSpreadHtml: string = renderToStaticMarkup(<Main.NativeField {...nativeFieldProps} />);
		if (nativeFieldSpreadHtml != "<section aria-controls=\"spread-panel\">spread-panel</section>") {
			throw Exception.thrown("Unexpected native-field spread HTML: " + nativeFieldSpreadHtml);
		};
		if (spreadNativeValue != "spread-panel") {
			throw Exception.thrown("Unexpected native-field spread callback value: " + spreadNativeValue);
		};
		const requiredChildHtml: JSX.Element = <strong>required</strong>;
		const requiredChildHtml1: string = renderToStaticMarkup(<Main.RequiredChild>{requiredChildHtml}</Main.RequiredChild>);
		if (requiredChildHtml1 != "<section><strong>required</strong></section>") {
			throw Exception.thrown("Unexpected required child HTML: " + requiredChildHtml1);
		};
		const broadNodeHtml: JSX.Element = <strong key="broad-element">element child</strong>;
		const broadNodeHtml1: string = renderToStaticMarkup(<Main.BroadNode>text child{broadNodeHtml}</Main.BroadNode>);
		if (broadNodeHtml1 != "<section>text child<strong>element child</strong></section>") {
			throw Exception.thrown("Unexpected broad node HTML: " + broadNodeHtml1);
		};
		const booleanAndArrayHtml: string = renderToStaticMarkup(<button disabled aria-pressed>{["A", "B"]}</button>);
		if (booleanAndArrayHtml != "<button disabled=\"\" aria-pressed=\"true\">AB</button>") {
			throw Exception.thrown("Unexpected boolean/array HTML: " + booleanAndArrayHtml);
		};
		const stringFormAction: JSX.Element = <form action="/save" />;
		const syncFormActionElement: JSX.Element = <form action={Main.syncFormAction} />;
		const asyncFormActionElement: JSX.Element = <form action={Main.asyncFormAction} />;
		const contextualFormAction: JSX.Element = <form action={function (formData: FormData) {
			formData.has("title");
		}} />;
		const buttonFormAction: JSX.Element = <button formAction={Main.syncFormAction}>Save</button>;
		const inputFormAction: JSX.Element = <input type="submit" formAction={Main.asyncFormAction} />;
		const dashPattern: string = "8 4";
		const dashOffset: number = 2.5;
		const dashedCircleHtml: JSX.Element = <circle cx={5} cy={5} r={4} strokeDasharray={dashPattern} strokeDashoffset={dashOffset} />;
		const dashedCircleHtml1: string = renderToStaticMarkup(<svg viewBox="0 0 10 10">{dashedCircleHtml}</svg>);
		if (dashedCircleHtml1 != "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" stroke-dasharray=\"8 4\" stroke-dashoffset=\"2.5\"></circle></svg>") {
			throw Exception.thrown("Unexpected dashed SVG HTML: " + dashedCircleHtml1);
		};
		const listHtml: string = renderToStaticMarkup(Main.renderChildList("ready", "queued"));
		if (listHtml != "<div><span>ready</span><strong>queued</strong><button>Save</button><em>done</em><span>ready:1</span><strong>queued:2</strong><span>ready:3</span><strong>queued:4</strong><span>ready:5</span><strong>queued:6</strong><span>ready:7</span><strong>queued:8</strong></div>") {
			throw Exception.thrown("Unexpected list HTML: " + listHtml);
		};
		const loweredHtml: string = renderToStaticMarkup(Main.renderLoweredChildList("ready", "queued"));
		if (loweredHtml != "<div><span>ready</span><strong>queued</strong><em>done</em><span>ready:1</span><strong>queued:2</strong></div>") {
			throw Exception.thrown("Unexpected lowered list HTML: " + loweredHtml);
		};
		Main.jsxEvaluationOrder = [];
		const orderedHtml: string = renderToStaticMarkup(Main.renderOrderedChildList());
		if (orderedHtml != "<div data-order=\"parent\"><span>first</span><strong>second</strong></div>") {
			throw Exception.thrown("Unexpected ordered HTML: " + orderedHtml);
		};
		if (Main.jsxEvaluationOrder.join(">") != "parent>first>second") {
			throw Exception.thrown("Unexpected JSX evaluation order: " + Main.jsxEvaluationOrder.join(">"));
		};
		const authoredChildHtml: string = renderToStaticMarkup(Main.renderAuthoredChild("named"));
		if (authoredChildHtml != "<div><span>named</span></div>") {
			throw Exception.thrown("Unexpected authored child HTML: " + authoredChildHtml);
		};
		const sharedChildHtml: string = renderToStaticMarkup(Main.renderSharedChild("shared"));
		if (sharedChildHtml != "<div><span>shared</span><span>shared</span></div>") {
			throw Exception.thrown("Unexpected shared child HTML: " + sharedChildHtml);
		};
		const frag: JSX.Element = <><span>A</span><span>B</span></>;
		const fragHtml: string = renderToStaticMarkup(frag);
		if (fragHtml != "<span>A</span><span>B</span>") {
			throw Exception.thrown("Unexpected fragment HTML: " + fragHtml);
		};
		const contextualClick: JSX.Element = <button onClick={function (event: import('react').MouseEvent<HTMLElement>) {
			event.preventDefault();
		}}>Contextual</button>;
		renderToStaticMarkup(contextualClick);
		const contextualAnchor: JSX.Element = <a onClick={function (event: import('react').MouseEvent<HTMLAnchorElement>) {
			event.currentTarget.download = "report.csv";
			event.currentTarget.rel = "noopener";
			event.currentTarget.protocol = "https:";
			event.currentTarget.focus();
		}}>Download</a>;
		renderToStaticMarkup(contextualAnchor);
		renderToStaticMarkup(<a onClick={standardAnchorHandler}>Standard DOM</a>);
		const compatibleAnchorHandler: ((arg0: import('react').MouseEvent<HTMLAnchorElement>) => void) = function (event: import('react').MouseEvent<HTMLAnchorElement>) {
			event.preventDefault();
		};
		renderToStaticMarkup(<a onClick={compatibleAnchorHandler}>Compatible</a>);
		const absentHref: string | undefined = undefined;
		const absentHrefHtml: string = renderToStaticMarkup(<a href={absentHref}>Absent href</a>);
		if (absentHrefHtml != "<a>Absent href</a>") {
			throw Exception.thrown("Unexpected absent href HTML: " + absentHrefHtml);
		};
		const contextualInput: JSX.Element = <input onChange={function (event: import('react').ChangeEvent<HTMLInputElement>) {
			console.log("tests/genes-ts/snapshot/react/src/Main.hx:309:",event.target.value);
			event.target.select();
			event.target.setSelectionRange(0, 0);
		}} />;
		renderToStaticMarkup(contextualInput);
		const okHandler: (() => void) = function () {
			return;
		};
		const okClick: JSX.Element = <button onClick={okHandler}>Click</button>;
		renderToStaticMarkup(okClick);
		const ignoredEvent: JSX.Element = <button onClick={function () {
			return "ignored";
		}}>Ignored</button>;
		renderToStaticMarkup(ignoredEvent);
		const optionalChildren: MainOptionalSpreadChildProps = {};
		const optionalChildSpreadHtml: JSX.Element = <strong>nested child</strong>;
		const optionalChildSpreadHtml1: string = renderToStaticMarkup(<Main.RequiredChild {...optionalChildren}>{optionalChildSpreadHtml}</Main.RequiredChild>);
		if (optionalChildSpreadHtml1 != "<section><strong>nested child</strong></section>") {
			throw Exception.thrown("Unexpected optional child spread HTML: " + optionalChildSpreadHtml1);
		};
		const previousChild: JSX.Element = <em>spread child</em>;
		const presentOptionalChildren: MainOptionalSpreadChildProps = {"children": previousChild};
		const optionalChildOverrideHtml: JSX.Element = <strong>nested child</strong>;
		const optionalChildOverrideHtml1: string = renderToStaticMarkup(<Main.RequiredChild {...presentOptionalChildren}>{optionalChildOverrideHtml}</Main.RequiredChild>);
		if (optionalChildOverrideHtml1 != "<section><strong>nested child</strong></section>") {
			throw Exception.thrown("Unexpected optional child override HTML: " + optionalChildOverrideHtml1);
		};
		const childArray: JSX.Element[] = [<em key="array-a">array A</em>, <strong key="array-b">array B</strong>];
		const arrayValueChildHtml: string = renderToStaticMarkup(<Main.RequiredChildList>{childArray}</Main.RequiredChildList>);
		if (arrayValueChildHtml != "<section><em>array A</em><strong>array B</strong></section>") {
			throw Exception.thrown("Unexpected array-valued child HTML: " + arrayValueChildHtml);
		};
		const optionalChildList: MainOptionalSpreadChildListProps = {};
		const multipleRequiredChildrenHtml: JSX.Element = <em key="nested-a">nested A</em>;
		const multipleRequiredChildrenHtml1: JSX.Element = <strong key="nested-b">nested B</strong>;
		const multipleRequiredChildrenHtml2: string = renderToStaticMarkup(<Main.RequiredChildList {...optionalChildList}>{multipleRequiredChildrenHtml}{multipleRequiredChildrenHtml1}</Main.RequiredChildList>);
		if (multipleRequiredChildrenHtml2 != "<section><em>nested A</em><strong>nested B</strong></section>") {
			throw Exception.thrown("Unexpected multiple required children HTML: " + multipleRequiredChildrenHtml2);
		};
	}
	static renderChildList(first: string, second: string): JSX.Element {
		const Button: ((arg0: {
			label: string
		}) => JSX.Element) = __genes_import_Button;
		return <div><span>{first}</span><strong>{second}</strong><Button label="Save" /><em>done</em><span>{first + ":1"}</span><strong>{second + ":2"}</strong><span>{first + ":3"}</span><strong>{second + ":4"}</strong><span>{first + ":5"}</span><strong>{second + ":6"}</strong><span>{first + ":7"}</span><strong>{second + ":8"}</strong></div>;
	}

	/**
	 * Keeps effectful values in explicit sequence while source JSX recovers the
	 * pure nested element tree around those already-evaluated locals.
	 */
	static renderOrderedChildList(): JSX.Element {
		const tmp = {"data-order": Main.recordJsxEvaluation("parent")};
		const tmp1: string = Main.recordJsxEvaluation("first");
		const span: JSX.Element = <span>{tmp1}</span>;
		const tmp3: string = Main.recordJsxEvaluation("second");
		return <div data-order={tmp["data-order"]}>{span}<strong>{tmp3}</strong></div>;
	}

	/**
	 * One-use authored locals remain visible even when their value is pure.
	 */
	static renderAuthoredChild(label: string): JSX.Element {
		const child: JSX.Element = <span>{label}</span>;
		return <div>{child}</div>;
	}

	/**
	 * Shared JSX values retain one declaration and two reads.
	 */
	static renderSharedChild(label: string): JSX.Element {
		const child: JSX.Element = <span>{label}</span>;
		return <div>{child}{child}</div>;
	}
	static recordJsxEvaluation(label: string): string {
		Main.jsxEvaluationOrder.push(label);
		return label;
	}
	static GenericValue<T>(props: GenericValueProps<T>): JSX.Element {
		const tmp: string = props.render(props.value);
		return <span>{tmp}</span>;
	}
	static InheritedCard(props: InheritedCardProps): JSX.Element {
		return <aside data-tone={props.tone} onClick={props.onSelect}>{props.label}</aside>;
	}
	static NativeField(props: NativeFieldProps): JSX.Element {
		props["on-value"](props["aria-controls"]);
		return <section aria-controls={props["aria-controls"]}>{props["aria-controls"]}</section>;
	}
	static RequiredChild(props: RequiredChildProps): JSX.Element {
		return <section>{props.children}</section>;
	}
	static BroadNode(props: BroadNodeProps): JSX.Element {
		return <section>{props.children}</section>;
	}

	/**
	 * Renders the ordered array required by this component contract.
	 */
	static RequiredChildList(props: MainRequiredChildListProps): JSX.Element {
		return <section>{props.children}</section>;
	}
	static renderLoweredChildList(first: string, second: string): JSX.Element {
		const span: JSX.Element = <span>{first}</span>;
		const strong: JSX.Element = <strong>{second}</strong>;
		const em: JSX.Element = <em>done</em>;
		const span_1: JSX.Element = <span>{first + ":1"}</span>;
		const strong_1: JSX.Element = <strong>{second + ":2"}</strong>;
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


Main.jsxEvaluationOrder = []
/**
 * Property bag proving that an HXX spread may omit `children`.
 *
 * `@:optional` allows omission in Haxe, which is the presence fact exercised
 * here. `@:ts.optional` is deliberately absent because it controls the
 * generated value's null/undefined spelling, not whether the field can be
 * missing. Nested HXX content must be the required child's final value whether
 * this spread omits `children` or supplies an older value.
 */
export type MainOptionalSpreadChildProps = {
	children?: JSX.Element | null
}

/**
 * Component contract that requires an array rather than one scalar child.
 */
export type MainRequiredChildListProps = {
	children: JSX.Element[]
}

/**
 * Optional spread counterpart used before several nested children.
 */
export type MainOptionalSpreadChildListProps = {
	children?: JSX.Element[] | null
}
