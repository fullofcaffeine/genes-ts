import genes.react.JSX.*;
import genes.ts.Imports;

@:jsx_inline_markup
class Main {
  static function main() {
    final title = "Hi";

    // NodeNext-friendly specifier: TS resolves `./components/Button.js` to
    // `./components/Button.tsx` at compile time, and emitted JS imports `.js`.
    final Button: Any = Imports.defaultImport("./components/Button.js");

    final el = <div className={"root"} data-test-id="x">{title}<span>{1 + 1}</span></div>;
    final renderToStaticMarkup: Any->String = Imports.namedImport("react-dom/server",
      "renderToStaticMarkup");
    final html = renderToStaticMarkup(el);
    if (html != '<div class="root" data-test-id="x">Hi<span>2</span></div>')
      throw 'Unexpected HTML: ' + html;

    final buttonEl = jsx('<Button label={"Save"} />');
    final buttonHtml = renderToStaticMarkup(buttonEl);
    if (buttonHtml != '<button>Save</button>')
      throw 'Unexpected button HTML: ' + buttonHtml;

    final frag = jsx('<><span>A</span><span>B</span></>');
    final fragHtml = renderToStaticMarkup(frag);
    if (fragHtml != '<span>A</span><span>B</span>')
      throw 'Unexpected fragment HTML: ' + fragHtml;

    // Ensure intrinsic element types are enforced (via @types/react):
    // If `JSX.IntrinsicElements["div"]` is missing/any, this line would not error
    // and TypeScript would fail due to an unused expect-error.
    js.Syntax.code("// @ts-expect-error");
    final bad = jsx('<div href=\"nope\"></div>');
    renderToStaticMarkup(bad);
  }
}
