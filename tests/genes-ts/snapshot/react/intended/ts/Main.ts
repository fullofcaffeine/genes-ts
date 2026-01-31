import * as React__genes_jsx from "react"
import {renderToStaticMarkup as __genes_import_renderToStaticMarkup} from "react-dom/server"
import {Exception} from "./haxe/Exception.js"
import {Register} from "./genes/Register.js"
import __genes_import_Button from "./components/Button.js"

export class Main {
	static main(): void {
		let title: string = "Hi";
		let Button: ((arg0: {
			label: string
		}) => JSX.Element) = __genes_import_Button;
		let el: JSX.Element = React__genes_jsx.createElement("span", null, 2);
		let el1: JSX.Element = React__genes_jsx.createElement("div", ({className: "root", "data-test-id": "x"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), title, el);
		let renderToStaticMarkup: ((arg0: JSX.Element) => string) = __genes_import_renderToStaticMarkup;
		let html: string = renderToStaticMarkup(el1);
		if (html != "<div class=\"root\" data-test-id=\"x\">Hi<span>2</span></div>") {
			throw Exception.thrown("Unexpected HTML: " + html);
		};
		let buttonEl: JSX.Element = React__genes_jsx.createElement(Button, ({label: "Save"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Button> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let buttonHtml: string = renderToStaticMarkup(buttonEl);
		if (buttonHtml != "<button>Save</button>") {
			throw Exception.thrown("Unexpected button HTML: " + buttonHtml);
		};
		let divProps: {
			className: string,
			id: string
		} = {"className": "spread", "id": "x"};
		let divWithSpread: JSX.Element = React__genes_jsx.createElement("div", ({...divProps} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Z");
		let divWithSpreadHtml: string = renderToStaticMarkup(divWithSpread);
		if (divWithSpreadHtml != "<div class=\"spread\" id=\"x\">Z</div>") {
			throw Exception.thrown("Unexpected spread HTML: " + divWithSpreadHtml);
		};
		let buttonProps: {
			label: string
		} = {"label": "Spread"};
		let buttonSpreadEl: JSX.Element = React__genes_jsx.createElement(Button, ({...buttonProps} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Button> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		let buttonSpreadHtml: string = renderToStaticMarkup(buttonSpreadEl);
		if (buttonSpreadHtml != "<button>Spread</button>") {
			throw Exception.thrown("Unexpected spread button HTML: " + buttonSpreadHtml);
		};
		let frag: JSX.Element = React__genes_jsx.createElement(React__genes_jsx.Fragment, null, React__genes_jsx.createElement("span", null, "A"), React__genes_jsx.createElement("span", null, "B"));
		let fragHtml: string = renderToStaticMarkup(frag);
		if (fragHtml != "<span>A</span><span>B</span>") {
			throw Exception.thrown("Unexpected fragment HTML: " + fragHtml);
		};
		let okHandler: (() => void) = function () {
			console.log("tests/genes-ts/snapshot/react/src/Main.hx:48:","ok");
		};
		let okClick: JSX.Element = React__genes_jsx.createElement("button", ({onClick: okHandler} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Click");
		renderToStaticMarkup(okClick);
		let badHandler: string = "nope";
		// @ts-expect-error;
		let badClick: JSX.Element = React__genes_jsx.createElement("button", ({onClick: badHandler} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"button"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })), "Bad");
		renderToStaticMarkup(badClick);
		// @ts-expect-error;
		let badButton: JSX.Element = React__genes_jsx.createElement(Button, ({label: 123} satisfies (React__genes_jsx.ComponentPropsWithoutRef<typeof Button> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		renderToStaticMarkup(badButton);
		// @ts-expect-error;
		let bad: JSX.Element = React__genes_jsx.createElement("div", ({href: "nope"} satisfies (React__genes_jsx.ComponentPropsWithoutRef<"div"> & { [K in `data-${string}`]?: string | number | boolean | null | undefined } & { [K in `aria-${string}`]?: string | number | boolean | null | undefined })));
		renderToStaticMarkup(bad);
	}
	static get __name__(): string {
		return "Main"
	}
	get __class__(): Function {
		return Main
	}
}
Register.setHxClass("Main", Main);
