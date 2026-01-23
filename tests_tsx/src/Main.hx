import genes.react.JSX.*;

@:jsRequire("react-dom/server")
private extern class ReactDOMServer {
  public static function renderToStaticMarkup(element: Dynamic): String;
}

@:jsx_inline_markup
class Main {
  static function main() {
    final title = "Hi";

    final el = <div className={"root"} data-test-id="x">{title}<span>{1 + 1}</span></div>;
    final html = ReactDOMServer.renderToStaticMarkup(el);
    if (html != '<div class="root" data-test-id="x">Hi<span>2</span></div>')
      throw 'Unexpected HTML: ' + html;

    final frag = jsx('<><span>A</span><span>B</span></>');
    final fragHtml = ReactDOMServer.renderToStaticMarkup(frag);
    if (fragHtml != '<span>A</span><span>B</span>')
      throw 'Unexpected fragment HTML: ' + fragHtml;

    // Ensure intrinsic element types are enforced (via @types/react):
    // If `JSX.IntrinsicElements["div"]` is missing/any, this line would not error
    // and TypeScript would fail due to an unused expect-error.
    js.Syntax.code("// @ts-expect-error");
    final bad = jsx('<div href=\"nope\"></div>');
    ReactDOMServer.renderToStaticMarkup(bad);
  }
}
