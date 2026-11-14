import genes.react.Element;
import genes.react.internal.Jsx;

/**
 * The first module of the probe. It uses only the closed tag.
 *
 * The typed marker call is what HXX lowers to, so `JsxPlan` checks these
 * properties itself and the earlier HXX frontend is not involved.
 */
class ProviderSchemaFirst {
  public static function view(): Element {
    return Jsx.__jsx("x-closed", {
      __genesJsxPropName: "label",
      __genesJsxPropValue: "first",
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    }, {__genesJsxChildrenEnd: true});
  }
}
