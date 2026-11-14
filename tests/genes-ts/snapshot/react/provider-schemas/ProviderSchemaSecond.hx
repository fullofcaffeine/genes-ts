import genes.react.Element;
import genes.react.internal.Jsx;

/**
 * The second module of the probe. Its plan is built after the first one.
 *
 * It uses the closed tag again, then the open tag, whose `values` element
 * type this use binds to `String`.
 */
class ProviderSchemaSecond {
  public static function view(): Element {
    return Jsx.__jsx("x-closed", {
      __genesJsxPropName: "label",
      __genesJsxPropValue: "second",
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    }, {__genesJsxChildrenEnd: true});
  }

  public static function list(): Element {
    return Jsx.__jsx("x-open", {
      __genesJsxPropName: "values",
      __genesJsxPropValue: ["later"],
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    }, {__genesJsxChildrenEnd: true});
  }
}
