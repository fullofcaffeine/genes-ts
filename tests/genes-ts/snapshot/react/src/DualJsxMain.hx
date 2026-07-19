import genes.react.Element;
import genes.react.JSX.*;
import genes.react.internal.Jsx;
import genes.ts.Imports;

typedef DualJsxTranscript = {
  final staticHtml: String;
  final optionalSpreadHtml: String;
  final optionalSpreadOverrideHtml: String;
  final arrayValueChildHtml: String;
  final multipleRequiredChildrenHtml: String;
  final dashedSvgHtml: String;
  final dynamicHtml: String;
  final evaluatedHtml: String;
  final arrayPropHtml: String;
  final arrayChildHtml: String;
  final propEvaluations: Int;
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

  static function main(): Void {
    final renderToStaticMarkup: Element->String = Imports.namedImport(
      "react-dom/server", "renderToStaticMarkup");
    final heading = "dual";
    final rootProps = {className: "shared", id: "root"};
    final fragment = jsx('<><span>A</span><span>B</span></>');
    final tree = <main {...rootProps}><h1>{heading}</h1>{fragment}</main>;
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
      optionalSpreadHtml: renderToStaticMarkup(optionalSpreadElement),
      optionalSpreadOverrideHtml:
        renderToStaticMarkup(optionalSpreadOverrideElement),
      arrayValueChildHtml: renderToStaticMarkup(arrayValueChildElement),
      multipleRequiredChildrenHtml:
        renderToStaticMarkup(multipleRequiredChildrenElement),
      dashedSvgHtml: renderToStaticMarkup(dashedSvgElement),
      dynamicHtml: renderToStaticMarkup(dynamicElement),
      evaluatedHtml: renderToStaticMarkup(evaluatedElement),
      arrayPropHtml: renderToStaticMarkup(arrayPropElement),
      arrayChildHtml: renderToStaticMarkup(arrayChildElement),
      propEvaluations: propEvaluations
    });
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
