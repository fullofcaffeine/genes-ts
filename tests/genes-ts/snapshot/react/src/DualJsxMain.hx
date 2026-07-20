import genes.react.DomElement;
import genes.react.Element;
import genes.react.JSX.*;
import genes.react.SyntheticEvent;
import genes.react.internal.Jsx;
import genes.react.InputElement;
import genes.react.ReactRef.RefObject;
import genes.ts.Imports;

typedef DualJsxTranscript = {
  final staticHtml: String;
  final sameExpressionOrderHtml: String;
  final nestedNameScopeHtml: String;
  final staticTagReadOrderHtml: String;
  final directAssignmentHtml: String;
  final localComponentHtml: String;
  final capturedChildHtml: String;
  final optionalSpreadHtml: String;
  final optionalSpreadOverrideHtml: String;
  final arrayValueChildHtml: String;
  final multipleRequiredChildrenHtml: String;
  final dashedSvgHtml: String;
  final dialogHtml: String;
  final inputRefHtml: String;
  final namedRefHtml: String;
  final cleanupRefHtml: String;
  final objectRefHtml: String;
  final nullRefHtml: String;
  final svgRefHtml: String;
  final focusedChangeHtml: String;
  final dynamicHtml: String;
  final evaluatedHtml: String;
  final arrayPropHtml: String;
  final arrayChildHtml: String;
  final propEvaluations: Int;
}

/** Small reusable event view that consumes only the field this handler needs. */
typedef FocusedInputChange = {
  final target: {
    final value: String;
  };
}

/**
 * Property bag used to prove that an optional spread does not definitely
 * provide React children.
 *
 * `@:optional` permits the field to be omitted in Haxe, which is the only fact
 * this presence test needs. `@:ts.optional` is deliberately absent: that
 * separate annotation controls how an optional value is written in generated
 * TypeScript, not whether the property exists at runtime.
 */
typedef OptionalSpreadChildProps = {
  @:optional
  var children: Element;
}

/** Component contract whose child must be supplied by spread or nesting. */
typedef RequiredSpreadChildProps = {
  final children: Element;
}

/** Component contract that requires an array rather than one scalar child. */
typedef RequiredSpreadChildListProps = {
  final children: Array<Element>;
}

/** Spread whose entire child array may be absent. */
typedef OptionalSpreadChildListProps = {
  @:optional
  var children: Array<Element>;
}

/**
 * Same-source runtime contract for JSX intent in TSX and classic Genes JS.
 *
 * Why: the main React fixture proves TypeScript surface quality, while this
 * smaller program proves that identical typed Haxe marker intent executes with
 * the same React semantics after either target printer consumes `JsxPlan`.
 *
 * What/How: inline markup covers intrinsic tags, spread props, nested children,
 * and a fragment. The direct internal marker represents a runtime string tag,
 * which cannot be spelled as a static JSX name and must use createElement in
 * both profiles. Only the final typed JSON string crosses the console boundary.
 */
class DualJsxMain {
  static var propEvaluations = 0;

  static function syncFormAction(data: PreciseFormData): Void {
    data.has("title");
  }

  /**
   * Handles any event whose current target is an ordinary HTML element.
   *
   * A dialog is a more specific kind of HTML element, so this broader handler
   * is safe for `onClose`. The fixture protects that useful relationship: HXX
   * should accept the handler while still rejecting one that requires an
   * unrelated element such as an input.
   */
  static function handleDialogClose(event: SyntheticEvent<DomElement>): Void {
    event.preventDefault();
  }

  /**
   * Reusable input ref whose named type must stay attached to the `<input>`.
   *
   * Hook and library APIs normally return a callback value instead of an
   * inline lambda. Keeping this named case beside the inline case proves HXX
   * validates both authoring shapes with the same exact input target.
   */
  static function handleInputRef(element: Null<InputElement>): Void {
    if (element != null)
      element.select();
  }

  static function main(): Void {
    final renderToStaticMarkup: Element->String = Imports.namedImport(
      "react-dom/server", "renderToStaticMarkup");
    final heading = "dual";
    final rootProps = {className: "shared", id: "root"};
    final fragment = jsx('<><span>A</span><span>B</span></>');
    final tree = <main {...rootProps}><h1>{heading}</h1>{fragment}</main>;
    final sameExpressionOrder = renderSameExpressionOrder();
    final nestedNameScope = renderNestedNameScope();
    final staticTagReadOrder = renderStaticTagReadOrder();
    final directAssignment = renderDirectAssignment();
    final localComponent = renderLocalComponentTags();
    final capturedChild = renderCapturedChild();
    final optionalChildren: OptionalSpreadChildProps = {};
    final optionalSpreadElement = <RequiredChildHost {...optionalChildren}>
      <strong>nested child</strong>
    </RequiredChildHost>;
    final previousChild = <em>spread child</em>;
    final presentOptionalChildren: OptionalSpreadChildProps = {
      children: previousChild
    };
    final optionalSpreadOverrideElement =
      <RequiredChildHost {...presentOptionalChildren}>
        <strong>nested child</strong>
      </RequiredChildHost>;
    final childArray = [
      <em key="array-a">array A</em>,
      <strong key="array-b">array B</strong>
    ];
    final arrayValueChildElement =
      <RequiredChildListHost>{childArray}</RequiredChildListHost>;
    final optionalChildList: OptionalSpreadChildListProps = {};
    final multipleRequiredChildrenElement =
      <RequiredChildListHost {...optionalChildList}>
        <em key="nested-a">nested A</em>
        <strong key="nested-b">nested B</strong>
      </RequiredChildListHost>;
    final dashPattern = "8 4";
    final dashOffset = 2.5;
    final dashedSvgElement = <svg viewBox="0 0 10 10">
      <circle cx={5} cy={5} r={4}
        strokeDasharray={dashPattern}
        strokeDashoffset={dashOffset}
      />
    </svg>;
    // The same checked form action must erase to ordinary createElement props
    // in classic JS while TSX retains native JSX syntax.
    final formActionElement = <form action={syncFormAction}></form>;
    final buttonFormActionElement =
      <button formAction={syncFormAction}>Save</button>;
    // Dialog-specific properties stay closed and useful in Haxe. In
    // particular, the contextual event target is the native DialogElement,
    // so this `close()` call is checked before any target profile is emitted.
    final dialogElement = <dialog
      open
      closedby="any"
      onCancel={event -> event.currentTarget.close()}
      onClose={handleDialogClose}
    >Dialog content</dialog>;
    // Intrinsic refs are checked at HXX authoring time. The callback receives
    // the exact input element, while React still owns attachment and cleanup.
    final inputRefElement = <input aria-label="Ref target" ref={element -> {
      if (element != null)
        element.select();
    }} />;
    final namedInputRefElement = <input aria-label="Named ref"
      ref={handleInputRef}
    />;
    final cleanupRefElement = <input aria-label="Cleanup ref" ref={element -> {
      if (element != null)
        element.select();
      return () -> {};
    }} />;
    final createRef: Void->RefObject<InputElement> = Imports.namedImport(
      "react", "createRef");
    final inputRefObject = createRef();
    final objectRefElement = <input aria-label="Object ref" ref={inputRefObject} />;
    final nullRefElement = <input aria-label="Null ref" ref={null} />;
    // HTML and SVG are separate browser families. A broad SVG callback is safe
    // for every SVG tag, but it must never be mislabeled as `HTMLElement`.
    final svgRefElement = <svg aria-label="SVG ref" ref={element -> {
      if (element != null)
        element.focus();
    }} />;
    // A direct browser-identity relation for refs must not make existing,
    // deliberately focused structural event handlers nominal-only.
    final focusedChangeElement = <input aria-label="Focused change"
      onChange={focusedInputChange}
    />;

    final runtimeTag = "aside";
    final dynamicElement = Jsx.__jsx(runtimeTag, {
      __genesJsxPropName: "data-mode",
      __genesJsxPropValue: "dynamic",
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    }, {
      __genesJsxChildValue: "D",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    final evaluatedProp = {
      __genesJsxPropName: "title",
      __genesJsxPropValue: nextPropValue(),
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    };
    final evaluatedElement = Jsx.__jsx("div", evaluatedProp, {
      __genesJsxChildValue: "E",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    final evaluatedProps = {
      __genesJsxPropName: "data-array",
      __genesJsxPropValue: nextPropValue(),
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    };
    final arrayPropElement = Jsx.__jsx("div", evaluatedProps, {
      __genesJsxChildValue: "P",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    });
    final evaluatedChildren = {
      __genesJsxChildValue: nextPropValue(),
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    };
    final arrayChildElement = Jsx.__jsx("div", {__genesJsxPropsEnd: true}, evaluatedChildren);

    print({
      staticHtml: renderToStaticMarkup(tree),
      sameExpressionOrderHtml: renderToStaticMarkup(sameExpressionOrder),
      nestedNameScopeHtml: renderToStaticMarkup(nestedNameScope),
      staticTagReadOrderHtml: renderToStaticMarkup(staticTagReadOrder),
      directAssignmentHtml: renderToStaticMarkup(directAssignment),
      localComponentHtml: renderToStaticMarkup(localComponent),
      capturedChildHtml: renderToStaticMarkup(capturedChild),
      optionalSpreadHtml: renderToStaticMarkup(optionalSpreadElement),
      optionalSpreadOverrideHtml:
        renderToStaticMarkup(optionalSpreadOverrideElement),
      arrayValueChildHtml: renderToStaticMarkup(arrayValueChildElement),
      multipleRequiredChildrenHtml:
        renderToStaticMarkup(multipleRequiredChildrenElement),
      dashedSvgHtml: renderToStaticMarkup(dashedSvgElement),
      dialogHtml: renderToStaticMarkup(dialogElement),
      inputRefHtml: renderToStaticMarkup(inputRefElement),
      namedRefHtml: renderToStaticMarkup(namedInputRefElement),
      cleanupRefHtml: renderToStaticMarkup(cleanupRefElement),
      objectRefHtml: renderToStaticMarkup(objectRefElement),
      nullRefHtml: renderToStaticMarkup(nullRefElement),
      svgRefHtml: renderToStaticMarkup(svgRefElement),
      focusedChangeHtml: renderToStaticMarkup(focusedChangeElement),
      dynamicHtml: renderToStaticMarkup(dynamicElement),
      evaluatedHtml: renderToStaticMarkup(evaluatedElement),
      arrayPropHtml: renderToStaticMarkup(arrayPropElement),
      arrayChildHtml: renderToStaticMarkup(arrayChildElement),
      propEvaluations: propEvaluations
    });
  }

  /**
   * Proves how HXX preserves evaluation order when markup is a call argument.
   *
   * The first argument changes which component the local variable names. HXX
   * lifts that mutation before the nested child declaration, matching Haxe's
   * left-to-right argument order. Source-JSX cleanup may remove the child
   * declaration, but the rendered result must still be "after" in every
   * profile.
   */
  static function renderSameExpressionOrder(): Element {
    var OrderedComponent: EmptyComponentProps->Element = BeforeMutationChild;
    return keepElement(
      mutateComponent(() -> OrderedComponent = AfterMutationChild),
      <div><OrderedComponent /></div>
    );
  }

  /**
   * Proves that JSX name cleanup never treats a nested function as the same
   * JavaScript scope as its caller.
   *
   * The outer `tree` and `tree1` are both legal Haxe locals. The callback has
   * its own independent `tree` name. Source-JSX cleanup may simplify the
   * callback's generated markup names, but it must not rename the outer
   * `tree1` to `tree` and create two declarations with one JavaScript name.
   */
  static function renderNestedNameScope(): Element {
    final tree = "outer";
    final tree1 = () -> {
      final tree = <div><span>inner</span></div>;
      return tree;
    };
    return <section data-owner={tree}>{tree1()}</section>;
  }

  /**
   * Proves that moving a nested static component preserves property-read order.
   *
   * The fixture module exposes `Parent` and `Child` through JavaScript getters.
   * Reading either name is therefore observable even though Haxe types both as
   * an ordinary static method. The child must still be read before the parent,
   * matching the explicit temporary sequence used by classic Genes output.
   */
  static function renderStaticTagReadOrder(): Element {
    return <ObservableComponents.Parent>
      <ObservableComponents.Child />
    </ObservableComponents.Parent>;
  }

  /**
   * Proves a parent assigned directly to a local uses the closed grammar.
   *
   * The focused test suite also compiles this source with
   * `retain-untyped-meta`, which keeps `@:genesSourceInlineBarrier` in Haxe's
   * typed tree. Metadata is not one of the two wrappers the source-inline proof
   * may ignore, so that test profile must retain the nested child even though
   * ordinary local assignment is otherwise an admitted parent site. Normal
   * builds discard this test-only metadata and continue to prove the positive
   * direct-assignment optimization.
   */
  static function renderDirectAssignment(): Element {
    var result = <div>initial</div>;
    result = @:genesSourceInlineBarrier <section><span>assigned</span></section>;
    return result;
  }

  /**
   * Proves component tags already held in locals are safe lexical reads.
   *
   * Any observable field lookup happens at these explicit assignments. Moving
   * the generated nested child later changes only local-variable reads.
   */
  static function renderLocalComponentTags(): Element {
    final Parent: ObservableParentProps->Element = LocalParent;
    final Child: EmptyComponentProps->Element = LocalChild;
    return <Parent><Child /></Parent>;
  }

  /** A captured child has two uses and must retain its declaration. */
  static function renderCapturedChild(): Element {
    final child = <span>captured</span>;
    final capture = () -> child;
    capture();
    return <div>{child}</div>;
  }

  static function LocalParent(props: ObservableParentProps): Element {
    return <section>{props.children}</section>;
  }

  static function LocalChild(_: EmptyComponentProps): Element {
    return <span>local</span>;
  }

  static function mutateComponent(change: Void->Void): String {
    change();
    return "changed";
  }

  static function keepElement(_: String, element: Element): Element {
    return element;
  }

  static function BeforeMutationChild(_: EmptyComponentProps): Element {
    return <span>before</span>;
  }

  static function AfterMutationChild(_: EmptyComponentProps): Element {
    return <span>after</span>;
  }

  /** Consumes a safe structural subset of React's complete input event. */
  static function focusedInputChange(event: FocusedInputChange): Void {
    event.target.value;
  }

  /** Renders the one child required by this component's property contract. */
  static function RequiredChildHost(props: RequiredSpreadChildProps): Element {
    return <section>{props.children}</section>;
  }

  /** Renders the ordered array required by this component's contract. */
  static function RequiredChildListHost(
      props: RequiredSpreadChildListProps): Element {
    return <section>{props.children}</section>;
  }

  /** Proves a lifted marker property value is evaluated exactly once. */
  static function nextPropValue(): String {
    propEvaluations++;
    return "evaluated-once";
  }

  /** Emits one deterministic machine-readable line for the differential gate. */
  static function print(transcript: DualJsxTranscript): Void {
    final json = haxe.Json.stringify(transcript);
    // Haxe's standard library has no typed console writer that is portable
    // across this Node fixture and browser-oriented JS output. The unsafe JS
    // boundary is therefore one statement, and only accepts a typed String.
    js.Syntax.code("console.log({0})", json);
  }
}

/** Empty properties used by the local component-order regression. */
private typedef EmptyComponentProps = {}

/** Properties accepted by the observable parent component fixture. */
private typedef ObservableParentProps = {
  final children: Element;
}

/**
 * Typed view of a JavaScript module whose component properties are getters.
 *
 * Why: an extern static method looks pure in Haxe's typed tree, but JavaScript
 * may provide that property through a getter or Proxy trap. The fixture makes
 * those reads visible so source-JSX normalization cannot silently reorder them.
 *
 * What/How: `@:jsRequire` imports the module's default object. Haxe checks the
 * component property contracts below; the companion TypeScript/JavaScript
 * fixture records each actual property read at runtime.
 */
@:jsRequire("./observable-components.js", "default")
private extern class ObservableComponents {
  static function Parent(props: ObservableParentProps): Element;
  static function Child(props: EmptyComponentProps): Element;
}
