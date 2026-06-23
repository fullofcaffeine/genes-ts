import genes.react.JSX.*;
import genes.react.Element;
import genes.react.internal.Jsx;
import genes.ts.Imports;

typedef StringAccessor = Void->String;

typedef StringSignal = {
  final get: StringAccessor;
  final set: String->Void;
}

typedef CreateMemo = StringAccessor->StringAccessor;

typedef StatusProps = {
  final label: String;
  final value: String;
  @:optional
  final children: Element;
}

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

    final buttonEl = <Button label={"Save"} />;
    final buttonHtml = renderToStaticMarkup(buttonEl);
    if (buttonHtml != '<button>Save</button>')
      throw 'Unexpected button HTML: ' + buttonHtml;

    // Spread props (intrinsic + component).
    final divProps = {className: "spread", id: "x"};
    final divWithSpread = <div {...divProps}>Z</div>;
    final divWithSpreadHtml = renderToStaticMarkup(divWithSpread);
    if (divWithSpreadHtml != '<div class="spread" id="x">Z</div>')
      throw 'Unexpected spread HTML: ' + divWithSpreadHtml;

    final buttonProps = {label: "Spread"};
    final buttonSpreadEl = <Button {...buttonProps} />;
    final buttonSpreadHtml = renderToStaticMarkup(buttonSpreadEl);
    if (buttonSpreadHtml != '<button>Spread</button>')
      throw 'Unexpected spread button HTML: ' + buttonSpreadHtml;

    final createSignal: String->StringSignal = Imports.namedImport("./runtime/signals.js",
      "createSignal");
    final createMemo: CreateMemo = Imports.namedImport("./runtime/signals.js", "createMemo");
    final Status: StatusProps->Element = Imports.defaultImport("./components/Status.js");

    final count = createSignal("1");
    count.set("2");
    final summary = createMemo(() -> 'items:${count.get()}');
    final statusEl = <Status label={"Count"} value={summary()}><span>{count.get()}</span></Status>;
    final statusHtml = renderToStaticMarkup(statusEl);
    if (statusHtml != '<section data-label="Count"><strong>items:2</strong><span>2</span></section>')
      throw 'Unexpected status HTML: ' + statusHtml;

    final listHtml = renderToStaticMarkup(renderChildList("ready", "queued"));
    if (listHtml != '<div><span>ready</span><strong>queued</strong><button>Save</button><em>done</em><span>ready:1</span><strong>queued:2</strong><span>ready:3</span><strong>queued:4</strong><span>ready:5</span><strong>queued:6</strong><span>ready:7</span><strong>queued:8</strong></div>')
      throw 'Unexpected list HTML: ' + listHtml;
    final loweredHtml = renderToStaticMarkup(renderLoweredChildList("ready", "queued"));
    if (loweredHtml != '<div><span>ready</span><strong>queued</strong><em>done</em><span>ready:1</span><strong>queued:2</strong></div>')
      throw 'Unexpected lowered list HTML: ' + loweredHtml;

    final frag = jsx('<><span>A</span><span>B</span></>');
    final fragHtml = renderToStaticMarkup(frag);
    if (fragHtml != '<span>A</span><span>B</span>')
      throw 'Unexpected fragment HTML: ' + fragHtml;

    // Event handler typing.
    //
    // We can't reference React event types from Haxe without extern boilerplate,
    // but TS will still validate the handler type in the generated output.
    final okHandler = () -> {};
    final okClick = <button onClick={okHandler}>Click</button>;
    renderToStaticMarkup(okClick);

    final badHandler = "nope";
    js.Syntax.code("// @ts-expect-error");
    final badClick = <button onClick={badHandler}>Bad</button>;
    renderToStaticMarkup(badClick);

    // Component props typing.
    js.Syntax.code("// @ts-expect-error");
    final badButton = <Button label={123} />;
    renderToStaticMarkup(badButton);

    // Ensure intrinsic element types are enforced (via @types/react):
    // If `JSX.IntrinsicElements["div"]` is missing/any, this line would not error
    // and TypeScript would fail due to an unused expect-error.
    js.Syntax.code("// @ts-expect-error");
    final bad = <div href="nope"></div>;
    renderToStaticMarkup(bad);
  }

  static function renderChildList(first:String, second:String):Element {
    final Button: ({label: String}) -> Element = Imports.defaultImport("./components/Button.js");
    return <div>
      <span>{first}</span>
      <strong>{second}</strong>
      <Button label={"Save"} />
      <em>done</em>
      <span>{first + ":1"}</span>
      <strong>{second + ":2"}</strong>
      <span>{first + ":3"}</span>
      <strong>{second + ":4"}</strong>
      <span>{first + ":5"}</span>
      <strong>{second + ":6"}</strong>
      <span>{first + ":7"}</span>
      <strong>{second + ":8"}</strong>
    </div>;
  }

  static function renderLoweredChildList(first:String, second:String):Element {
    final tmp = Jsx.__jsx("span", [], [first]);
    final tmp1 = Jsx.__jsx("strong", [], [second]);
    final tmp2 = Jsx.__jsx("em", [], ["done"]);
    final tmp3 = Jsx.__jsx("span", [], [first + ":1"]);
    final tmp4 = Jsx.__jsx("strong", [], [second + ":2"]);
    return Jsx.__jsx("div", [], [tmp, tmp1, tmp2, tmp3, tmp4]);
  }
}
