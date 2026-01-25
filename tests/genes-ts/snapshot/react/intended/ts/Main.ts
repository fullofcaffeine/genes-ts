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
		let frag: JSX.Element = React__genes_jsx.createElement(React__genes_jsx.Fragment, null, React__genes_jsx.createElement("span", null, "A"), React__genes_jsx.createElement("span", null, "B"));
		let fragHtml: string = renderToStaticMarkup(frag);
		if (fragHtml != "<span>A</span><span>B</span>") {
			throw Exception.thrown("Unexpected fragment HTML: " + fragHtml);
		};
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
