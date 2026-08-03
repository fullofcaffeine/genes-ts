package react_hooks;

import genes.react.Element;

typedef SignatureProps = {
  final label: String;
}

/** Roots the selected invalid declaration when validation reaches DCE. */
class ComponentSignatureNegative {
  static function main(): Void {
    #if react_component_lowercase
    final retained = invalidComponent;
    #else
    final retained = InvalidComponent;
    #end
    if (retained == null)
      throw "component signature negative was not retained";
  }
}

#if react_component_second_argument
@:genes.reactComponent
function InvalidComponent(props: SignatureProps,
    legacyContext: String): Element {
  return invalidElement();
}
#elseif react_component_wrong_return
@:genes.reactComponent
function InvalidComponent(props: SignatureProps): String {
  return props.label;
}
#elseif react_component_rest_argument
@:genes.reactComponent
function InvalidComponent(props: haxe.Rest<SignatureProps>): Element {
  return invalidElement();
}
#elseif react_component_lowercase
@:genes.reactComponent
function invalidComponent(props: SignatureProps): Element {
  return invalidElement();
}
#elseif react_component_duplicate_module_marker
@:genes.reactComponent
@:genes.moduleFunction("InvalidComponent")
function InvalidComponent(props: SignatureProps): Element {
  return invalidElement();
}
#else
@:genes.reactComponent
@:overload(function(props: SignatureProps): Element {})
function InvalidComponent(props: SignatureProps): Element {
  return invalidElement();
}
#end

/** The negative fixture fails before this extern value can execute. */
function invalidElement(): Element {
  throw "unreachable component signature fixture";
}
