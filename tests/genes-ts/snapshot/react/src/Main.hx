import genes.react.JSX.*;
import genes.react.Element;
import genes.ts.Imports;

@:jsx_inline_markup
class Main {
  static function main() {
    final title = "Hi";

    // NodeNext-friendly specifier: TS resolves `./components/Button.js` to
    // `./components/Button.tsx` at compile time, and emitted JS imports `.js`.
    final Button: ({label: String}) -> Element = Imports.defaultImport("./components/Button.js");

    final el = <div className={"root"} data-test-id="x">{title}<span>{1 + 1}</span></div>;
    final renderToStaticMarkup: Element->String = Imports.namedImport("react-dom/server",
      "renderToStaticMarkup");
    final html = renderToStaticMarkup(el);
    if (html != '<div class="root" data-test-id="x">Hi<span>2</span></div>')
      throw 'Unexpected HTML: ' + html;

    final buttonEl = jsx('<Button label={"Save"} />');
    final buttonHtml = renderToStaticMarkup(buttonEl);
    if (buttonHtml != '<button>Save</button>')
      throw 'Unexpected button HTML: ' + buttonHtml;

    // Spread props (intrinsic + component).
    final divProps = {className: "spread", id: "x"};
    final divWithSpread = jsx('<div {...divProps}>Z</div>');
    final divWithSpreadHtml = renderToStaticMarkup(divWithSpread);
    if (divWithSpreadHtml != '<div class="spread" id="x">Z</div>')
      throw 'Unexpected spread HTML: ' + divWithSpreadHtml;

    final buttonProps = {label: "Spread"};
    final buttonSpreadEl = jsx('<Button {...buttonProps} />');
    final buttonSpreadHtml = renderToStaticMarkup(buttonSpreadEl);
    if (buttonSpreadHtml != '<button>Spread</button>')
      throw 'Unexpected spread button HTML: ' + buttonSpreadHtml;

    final frag = jsx('<><span>A</span><span>B</span></>');
    final fragHtml = renderToStaticMarkup(frag);
    if (fragHtml != '<span>A</span><span>B</span>')
      throw 'Unexpected fragment HTML: ' + fragHtml;

    // Event handler typing.
    //
    // We can't reference React event types from Haxe without extern boilerplate,
    // but TS will still validate the handler type in the generated output.
    final okHandler = () -> trace("ok");
    final okClick = jsx('<button onClick={okHandler}>Click</button>');
    renderToStaticMarkup(okClick);

    final badHandler = "nope";
    js.Syntax.code("// @ts-expect-error");
    final badClick = jsx('<button onClick={badHandler}>Bad</button>');
    renderToStaticMarkup(badClick);

    // Component props typing.
    js.Syntax.code("// @ts-expect-error");
    final badButton = jsx('<Button label={123} />');
    renderToStaticMarkup(badButton);

    // Ensure intrinsic element types are enforced (via @types/react):
    // If `JSX.IntrinsicElements["div"]` is missing/any, this line would not error
    // and TypeScript would fail due to an unused expect-error.
    js.Syntax.code("// @ts-expect-error");
    final bad = jsx('<div href=\"nope\"></div>');
    renderToStaticMarkup(bad);
  }
}
