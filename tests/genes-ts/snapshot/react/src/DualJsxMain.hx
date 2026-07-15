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
    final dynamicElement = Jsx.__jsx(runtimeTag, [
      {name: "data-mode", value: "dynamic"}
    ], ["D"]);
    final evaluatedProp = {name: "title", value: nextPropValue()};
    final evaluatedElement = Jsx.__jsx("div", [evaluatedProp], ["E"]);
    final evaluatedProps = [
      {name: "data-array", value: nextPropValue()}
    ];
    final arrayPropElement = Jsx.__jsx("div", evaluatedProps, ["P"]);
    final evaluatedChildren = [nextPropValue()];
    final arrayChildElement = Jsx.__jsx("div", [], evaluatedChildren);

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
    js.Syntax.code("console.log({0})", json);
  }
}
