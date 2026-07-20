import genes.react.JSX.*;
import genes.react.ComponentType;
import genes.react.DomElement;
import genes.react.Element;
import genes.react.MouseEvent;
import genes.react.Node;
import genes.react.SyntheticEvent;
import genes.react.internal.Jsx;
import genes.ts.Imports;
import genes.ts.Undefinable;

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

typedef RequiredChildProps = {
  final children: Element;
}

typedef BroadNodeProps = {
  final children: Node;
}

typedef GenericValueProps<T> = {
  final value: T;
  final render: T->String;
}

/** Base properties inherited by an extern component contract. */
interface InheritedBaseProps {
  var label: String;
  var onSelect: MouseEvent<DomElement>->Void;
}

/** Proves that HXX reads inherited fields, not only fields declared here. */
interface InheritedCardProps extends InheritedBaseProps {
  var tone: String;
}

/**
 * Positive React HXX fixture shared by typed TSX and createElement profiles.
 *
 * It proves local, imported, aliased, generic, and inherited component
 * contracts alongside intrinsic props, callbacks, spreads, and children. The
 * harness type-checks and executes the generated output.
 */
// The Haxe formatter does not yet understand component HXX reliably.
// @formatter:off
class Main {
  static var jsxEvaluationOrder: Array<String> = [];

  static function syncFormAction(data: PreciseFormData): Void {
    data.has("title");
  }

  static function asyncFormAction(data: PreciseFormData): js.lib.Promise<Void> {
    data.has("title");
    return js.lib.Promise.resolve();
  }

  static function main() {
    final title = "Hi";

    // Load the complete standard anchor extern before the intrinsic schema.
    // HXX contextual typing must remain deterministic in either module order.
    final standardAnchorHandler: MouseEvent<js.html.AnchorElement>->Void =
      event -> event.preventDefault();

    // NodeNext-friendly specifier: TS resolves `./components/Button.js` to
    // `./components/Button.tsx` at compile time, and emitted JS imports `.js`.
    final Button: ({label: String}) -> Element = Imports.defaultImport("./components/Button.js");

    final el = <div className="root" data-test-id="x">{title}<span>{1 + 1}</span></div>;
    final renderToStaticMarkup: Element->String = Imports.namedImport("react-dom/server",
      "renderToStaticMarkup");
    final html = renderToStaticMarkup(el);
    if (html != '<div class="root" data-test-id="x">Hi<span>2</span></div>')
      throw 'Unexpected HTML: ' + html;

    final buttonEl = <Button label="Save" />;
    final buttonHtml = renderToStaticMarkup(buttonEl);
    if (buttonHtml != '<button>Save</button>')
      throw 'Unexpected button HTML: ' + buttonHtml;

    final AliasedButton = Button;
    final aliasHtml = renderToStaticMarkup(<AliasedButton label="Alias" />);
    if (aliasHtml != '<button>Alias</button>')
      throw 'Unexpected alias HTML: ' + aliasHtml;

    final TypedButton: ComponentType<{label: String}> = Imports.defaultImport("./components/Button.js");
    final typedButtonHtml = renderToStaticMarkup(<TypedButton label="Typed" key={1.5} />);
    if (typedButtonHtml != '<button>Typed</button>')
      throw 'Unexpected typed button HTML: ' + typedButtonHtml;

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
    final statusEl = <Status label="Count" value={summary()}><span>{count.get()}</span></Status>;
    final statusHtml = renderToStaticMarkup(statusEl);
    if (statusHtml != '<section data-label="Count"><strong>items:2</strong><span>2</span></section>')
      throw 'Unexpected status HTML: ' + statusHtml;

    final GenericInt: GenericValueProps<Int>->Element = GenericValue;
    final genericHtml = renderToStaticMarkup(<GenericInt value={7} render={value -> 'n:$value'} />);
    if (genericHtml != '<span>n:7</span>')
      throw 'Unexpected generic HTML: ' + genericHtml;

    // The component remains generic at the tag. Haxe infers `T = Int` from
    // `value` before it gives the inline callback its parameter type.
    final directGenericHtml = renderToStaticMarkup(<GenericValue
      value={8}
      render={value -> 'n:$value'}
    />);
    if (directGenericHtml != '<span>n:8</span>')
      throw 'Unexpected direct generic HTML: ' + directGenericHtml;

    final broadHandler: SyntheticEvent<DomElement>->Void = event ->
      event.preventDefault();
    final inheritedHtml = renderToStaticMarkup(<InheritedCard
      label="Inherited"
      tone="warm"
      onSelect={broadHandler}
    />);
    if (inheritedHtml != '<aside data-tone="warm">Inherited</aside>')
      throw 'Unexpected inherited component HTML: ' + inheritedHtml;

    final requiredChildHtml = renderToStaticMarkup(<RequiredChild><strong>required</strong></RequiredChild>);
    if (requiredChildHtml != '<section><strong>required</strong></section>')
      throw 'Unexpected required child HTML: ' + requiredChildHtml;

    // `Node` deliberately remains the broad renderable contract. This is the
    // control for RequiredChild's exact one-Element property above.
    final broadNodeHtml = renderToStaticMarkup(
      <BroadNode>text child<strong key="broad-element">element child</strong></BroadNode>
    );
    if (broadNodeHtml != '<section>text child<strong>element child</strong></section>')
      throw 'Unexpected broad node HTML: ' + broadNodeHtml;

    final booleanAndArrayHtml = renderToStaticMarkup(<button disabled aria-pressed={true}>{["A", "B"]}</button>);
    if (booleanAndArrayHtml != '<button disabled="" aria-pressed="true">AB</button>')
      throw 'Unexpected boolean/array HTML: ' + booleanAndArrayHtml;

    // React 19 accepts either a URL or a function action. Named callbacks use
    // a precise alternate extern for the same native FormData global; the
    // inline callback proves the union still supplies contextual parameter
    // typing before TypeScript exists. Button and input share the same host
    // contract through `formAction`.
    final stringFormAction = <form action="/save"></form>;
    final syncFormActionElement = <form action={syncFormAction}></form>;
    final asyncFormActionElement = <form action={asyncFormAction}></form>;
    final contextualFormAction = <form action={formData -> {
      formData.has("title");
      return;
    }}></form>;
    final buttonFormAction = <button formAction={syncFormAction}>Save</button>;
    final inputFormAction = <input type="submit" formAction={asyncFormAction} />;

    // React spells SVG presentation properties in camelCase while authoring,
    // then writes their native dash-separated names into rendered markup.
    // Both string patterns and numeric offsets stay Haxe-checked here.
    final dashPattern = "8 4";
    final dashOffset = 2.5;
    final dashedCircleHtml = renderToStaticMarkup(
      <svg viewBox="0 0 10 10">
        <circle cx={5} cy={5} r={4}
          strokeDasharray={dashPattern}
          strokeDashoffset={dashOffset}
        />
      </svg>
    );
    if (dashedCircleHtml != '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke-dasharray="8 4" stroke-dashoffset="2.5"></circle></svg>')
      throw 'Unexpected dashed SVG HTML: ' + dashedCircleHtml;

    final listHtml = renderToStaticMarkup(renderChildList("ready", "queued"));
    if (listHtml != '<div><span>ready</span><strong>queued</strong><button>Save</button><em>done</em><span>ready:1</span><strong>queued:2</strong><span>ready:3</span><strong>queued:4</strong><span>ready:5</span><strong>queued:6</strong><span>ready:7</span><strong>queued:8</strong></div>')
      throw 'Unexpected list HTML: ' + listHtml;
    final loweredHtml = renderToStaticMarkup(renderLoweredChildList("ready", "queued"));
    if (loweredHtml != '<div><span>ready</span><strong>queued</strong><em>done</em><span>ready:1</span><strong>queued:2</strong></div>')
      throw 'Unexpected lowered list HTML: ' + loweredHtml;

    jsxEvaluationOrder = [];
    final orderedHtml = renderToStaticMarkup(renderOrderedChildList());
    if (orderedHtml != '<div data-order="parent"><span>first</span><strong>second</strong></div>')
      throw 'Unexpected ordered HTML: ' + orderedHtml;
    if (jsxEvaluationOrder.join(">") != "parent>first>second")
      throw 'Unexpected JSX evaluation order: ' + jsxEvaluationOrder.join(">");

    final authoredChildHtml = renderToStaticMarkup(renderAuthoredChild("named"));
    if (authoredChildHtml != '<div><span>named</span></div>')
      throw 'Unexpected authored child HTML: ' + authoredChildHtml;

    final sharedChildHtml = renderToStaticMarkup(renderSharedChild("shared"));
    if (sharedChildHtml != '<div><span>shared</span><span>shared</span></div>')
      throw 'Unexpected shared child HTML: ' + sharedChildHtml;

    final frag = jsx('<><span>A</span><span>B</span></>');
    final fragHtml = renderToStaticMarkup(frag);
    if (fragHtml != '<span>A</span><span>B</span>')
      throw 'Unexpected fragment HTML: ' + fragHtml;

    // HXX supplies React's handler type to an inline Haxe callback, so the
    // method access below is checked before TypeScript output exists.
    final contextualClick = <button onClick={event -> event.preventDefault()}>Contextual</button>;
    renderToStaticMarkup(contextualClick);

    // Element-specific intrinsic contracts retain Haxe's complete standard DOM
    // externs, including APIs absent from Genes' compatibility facade. Every
    // access below is checked before TSX exists.
    final contextualAnchor = <a onClick={event -> {
      event.currentTarget.download = "report.csv";
      event.currentTarget.rel = "noopener";
      event.currentTarget.protocol = "https:";
      event.currentTarget.focus();
    }}>Download</a>;
    renderToStaticMarkup(contextualAnchor);

    renderToStaticMarkup(<a onClick={standardAnchorHandler}>Standard DOM</a>);

    // Existing handlers that name the smaller Genes facade remain compatible
    // because both types carry the same browser element identity.
    final compatibleAnchorHandler: MouseEvent<genes.react.AnchorElement>->Void =
      event -> event.preventDefault();
    renderToStaticMarkup(<a onClick={compatibleAnchorHandler}>Compatible</a>);

    // React optional DOM properties distinguish a supplied JavaScript
    // undefined from Haxe null. The HXX checker accepts this explicit host
    // sentinel, and React omits the absent attribute at runtime.
    final absentHref: Undefinable<String> = Undefinable.absent();
    final absentHrefHtml = renderToStaticMarkup(<a href={absentHref}>Absent href</a>);
    if (absentHrefHtml != '<a>Absent href</a>')
      throw 'Unexpected absent href HTML: ' + absentHrefHtml;

    final contextualInput = <input onChange={event -> {
      trace(event.target.value);
      event.target.select();
      event.target.setSelectionRange(0, 0);
    }} />;
    renderToStaticMarkup(contextualInput);

    // React also accepts a callback that intentionally ignores its event.
    final okHandler = () -> {};
    final okClick = <button onClick={okHandler}>Click</button>;
    renderToStaticMarkup(okClick);

    // Inline callbacks may ignore the supplied event and return a value; this
    // is the same sound callback-subtyping rule used by TypeScript/React.
    final ignoredEvent = <button onClick={() -> "ignored"}>Ignored</button>;
    renderToStaticMarkup(ignoredEvent);

    final optionalChildren: MainOptionalSpreadChildProps = {};
    final optionalChildSpreadHtml = renderToStaticMarkup(
      <RequiredChild {...optionalChildren}>
        <strong>nested child</strong>
      </RequiredChild>
    );
    if (optionalChildSpreadHtml != '<section><strong>nested child</strong></section>')
      throw 'Unexpected optional child spread HTML: ' + optionalChildSpreadHtml;
    final previousChild = <em>spread child</em>;
    final presentOptionalChildren: MainOptionalSpreadChildProps = {
      children: previousChild
    };
    final optionalChildOverrideHtml = renderToStaticMarkup(
      <RequiredChild {...presentOptionalChildren}>
        <strong>nested child</strong>
      </RequiredChild>
    );
    if (optionalChildOverrideHtml != '<section><strong>nested child</strong></section>')
      throw 'Unexpected optional child override HTML: ' + optionalChildOverrideHtml;

    final childArray = [
      <em key="array-a">array A</em>,
      <strong key="array-b">array B</strong>
    ];
    final arrayValueChildHtml = renderToStaticMarkup(
      <RequiredChildList>{childArray}</RequiredChildList>
    );
    if (arrayValueChildHtml != '<section><em>array A</em><strong>array B</strong></section>')
      throw 'Unexpected array-valued child HTML: ' + arrayValueChildHtml;
    final optionalChildList: MainOptionalSpreadChildListProps = {};
    final multipleRequiredChildrenHtml = renderToStaticMarkup(
      <RequiredChildList {...optionalChildList}>
        <em key="nested-a">nested A</em>
        <strong key="nested-b">nested B</strong>
      </RequiredChildList>
    );
    if (multipleRequiredChildrenHtml != '<section><em>nested A</em><strong>nested B</strong></section>')
      throw 'Unexpected multiple required children HTML: ' + multipleRequiredChildrenHtml;
  }

  static function renderChildList(first:String, second:String):Element {
    final Button: ({label: String}) -> Element = Imports.defaultImport("./components/Button.js");
    return <div>
      <span>{first}</span>
      <strong>{second}</strong>
      <Button label="Save" />
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

  /**
   * Keeps effectful values in explicit sequence while source JSX recovers the
   * pure nested element tree around those already-evaluated locals.
   */
  static function renderOrderedChildList(): Element {
    return <div data-order={recordJsxEvaluation("parent")}>
      <span>{recordJsxEvaluation("first")}</span>
      <strong>{recordJsxEvaluation("second")}</strong>
    </div>;
  }

  /** One-use authored locals remain visible even when their value is pure. */
  static function renderAuthoredChild(label: String): Element {
    final child = <span>{label}</span>;
    return <div>{child}</div>;
  }

  /** Shared JSX values retain one declaration and two reads. */
  static function renderSharedChild(label: String): Element {
    final child = <span>{label}</span>;
    return <div>{child}{child}</div>;
  }

  static function recordJsxEvaluation(label: String): String {
    jsxEvaluationOrder.push(label);
    return label;
  }

  static function GenericValue<T>(props: GenericValueProps<T>): Element {
    return <span>{props.render(props.value)}</span>;
  }

  static function InheritedCard(props: InheritedCardProps): Element {
    return <aside data-tone={props.tone} onClick={props.onSelect}>
      {props.label}
    </aside>;
  }

  static function RequiredChild(props: RequiredChildProps): Element {
    return <section>{props.children}</section>;
  }

  static function BroadNode(props: BroadNodeProps): Element {
    return <section>{props.children}</section>;
  }

  /**
   * Proves aliases and element subclasses remain renderable HXX values.
   *
   * The method is a compile-time type-checking control rather than runtime
   * behavior. `ExactElementAlias` and `SpecializedElement` must each be
   * accepted as one renderable value, while `BroadNodeAlias` retains the
   * deliberately wider React-node contract.
   */
  static function elementContractControls(exact: ExactElementAlias,
      specialized: SpecializedElement, broad: BroadNodeAlias): Element {
    final exactChild = <BroadNode>{exact}</BroadNode>;
    final specializedChild = <BroadNode>{specialized}</BroadNode>;
    return <BroadNode>{[exactChild, specializedChild, broad]}</BroadNode>;
  }

  /** Renders the ordered array required by this component contract. */
  static function RequiredChildList(props: MainRequiredChildListProps): Element {
    return <section>{props.children}</section>;
  }

  static function renderLoweredChildList(first:String, second:String):Element {
    final tmp = Jsx.__jsx("span", {__genesJsxPropsEnd: true}, {
      __genesJsxChildValue: first,
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    final tmp1 = Jsx.__jsx("strong", {__genesJsxPropsEnd: true}, {
      __genesJsxChildValue: second,
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    final tmp2 = Jsx.__jsx("em", {__genesJsxPropsEnd: true}, {
      __genesJsxChildValue: "done",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    final tmp3 = Jsx.__jsx("span", {__genesJsxPropsEnd: true}, {
      __genesJsxChildValue: first + ":1",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    final tmp4 = Jsx.__jsx("strong", {__genesJsxPropsEnd: true}, {
      __genesJsxChildValue: second + ":2",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    return Jsx.__jsx("div", {__genesJsxPropsEnd: true}, {
      __genesJsxChildValue: tmp,
      __genesJsxChildNext: {
        __genesJsxChildValue: tmp1,
        __genesJsxChildNext: {
          __genesJsxChildValue: tmp2,
          __genesJsxChildNext: {
            __genesJsxChildValue: tmp3,
            __genesJsxChildNext: {
              __genesJsxChildValue: tmp4,
              __genesJsxChildNext: {__genesJsxChildrenEnd: true}
            }
          }
        }
      }
    });
  }
}
// @formatter:on
/**
 * Compile-only aliases for HXX's element and broad-node marker lookup.
 *
 * Why: aliases must preserve the same child contract as their underlying
 * types, but publishing test-only aliases would add unrelated API surface to
 * every generated React snapshot.
 *
 * What: `@:genes.compilerInternal` keeps each alias available while Haxe types
 * the fixture and removes it at the final output boundary.
 * `@:genes.semanticOnly` records that emitted code must not name the alias.
 *
 * How: `elementContractControls` makes HXX resolve these types before DCE. The
 * generated TypeScript and classic JavaScript remain unchanged by the aliases.
 */
@:genes.compilerInternal
@:genes.semanticOnly
private typedef ExactElementAlias = Element;

@:genes.compilerInternal
@:genes.semanticOnly
private typedef BroadNodeAlias = Node;

/**
 * Compile-only subtype control for inherited `@:genes.jsxElement`.
 *
 * Why: HXX should follow ordinary Haxe element subclassing without asking a
 * library facade to repeat compiler metadata.
 *
 * What: this extern supplies a more specific static type without claiming a
 * constructor or runtime value.
 *
 * How: the two internal markers keep the type available to HXX and remove it
 * before output, matching the alias controls above.
 */
@:genes.compilerInternal
@:genes.semanticOnly
private extern class SpecializedElement extends Element {}

/**
 * Property bag proving that an HXX spread may omit `children`.
 *
 * `@:optional` allows omission in Haxe, which is the presence fact exercised
 * here. `@:ts.optional` is deliberately absent because it controls the
 * generated value's null/undefined spelling, not whether the field can be
 * missing. Nested HXX content must be the required child's final value whether
 * this spread omits `children` or supplies an older value.
 */
typedef MainOptionalSpreadChildProps = {
  @:optional
  var children: Element;
}

/** Component contract that requires an array rather than one scalar child. */
typedef MainRequiredChildListProps = {
  final children: Array<Element>;
}

/** Optional spread counterpart used before several nested children. */
typedef MainOptionalSpreadChildListProps = {
  @:optional
  var children: Array<Element>;
}
