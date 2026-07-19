import genes.react.Element;
import genes.react.JSX.*;
import genes.react.internal.Jsx;
import genes.ts.Imports;

typedef DualJsxTranscript = {
  final staticHtml: String;
  final dynamicHtml: String;
  final evaluatedHtml: String;
  final arrayPropHtml: String;
  final arrayChildHtml: String;
  final propEvaluations: Int;
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
      dynamicHtml: renderToStaticMarkup(dynamicElement),
      evaluatedHtml: renderToStaticMarkup(evaluatedElement),
      arrayPropHtml: renderToStaticMarkup(arrayPropElement),
      arrayChildHtml: renderToStaticMarkup(arrayChildElement),
      propEvaluations: propEvaluations
    });
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
