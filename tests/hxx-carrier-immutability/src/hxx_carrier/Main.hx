package hxx_carrier;

import genes.react.Element;
import genes.react.internal.Jsx;

/** Typed namespace boundary for the React server renderer used by this test. */
@:jsRequire("react-dom/server")
private extern class ReactDomServer {
  static function renderToStaticMarkup(element: Element): String;
}

/**
 * Proves that an untouched local HXX carrier remains a safe one-time snapshot.
 *
 * The linked records below are compiler scaffolding, not application data.
 * Keeping them in locals is still useful because a property or child may have
 * a side effect that must run once before the JSX marker is consumed. The
 * focused harness checks both output profiles and the exact runtime result.
 */
class Main {
  static var evaluations = 0;

  static function evaluatedLabel(): String {
    evaluations++;
    return "kept";
  }

  static function main(): Void {
    final props = {
      __genesJsxPropName: "title",
      __genesJsxPropValue: evaluatedLabel(),
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    };
    final children = {
      __genesJsxChildValue: "carrier child",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    };
    final element = Jsx.__jsx("div", props, children);
    trace(haxe.Json.stringify({
      html: ReactDomServer.renderToStaticMarkup(element),
      evaluations: evaluations
    }));
  }
}
