package;

import genes.react.Element;
import genes.react.internal.Jsx;

/**
 * Negative cases for compiler-owned HXX carrier records.
 *
 * A carrier describes property names and linked-list structure to `JsxPlan`.
 * Changing or sharing that record after construction would let runtime data
 * disagree with the JSX meaning already validated by the compiler. Each build
 * define below must therefore fail at the first unsafe use.
 */
class Invalid {
  static function main(): Void {
    final props = {
      __genesJsxPropName: "title",
      __genesJsxPropValue: "before",
      __genesJsxPropNext: {
        __genesJsxPropsEnd: true
      }
    };
    final children = {
      __genesJsxChildValue: "before",
      __genesJsxChildNext: {__genesJsxChildrenEnd: true}
    };

    #if hxx_carrier_mutate_name
    props.__genesJsxPropName = "data-after";
    #elseif hxx_carrier_mutate_value
    props.__genesJsxPropValue = "after";
    #elseif hxx_carrier_mutate_child
    children.__genesJsxChildValue = "after";
    #elseif hxx_carrier_mutate_alias
    final sharedProps = props;
    sharedProps.__genesJsxPropName = "data-after";
    #end

    final value: Element = Jsx.__jsx("div",
      #if hxx_carrier_mutate_alias sharedProps #else props #end, children);
    trace(value);
  }
}
