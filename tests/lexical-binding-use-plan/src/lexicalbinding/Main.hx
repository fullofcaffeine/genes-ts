package lexicalbinding;

import lexicalbinding.DeepFour.deepFour;
import lexicalbinding.DeepEight.deepEight;
import lexicalbinding.DirectTarget.setStateFunction;
import lexicalbinding.DirectTarget.setStateValue;
import lexicalbinding.DynamicCases.nestedDynamicBindings;

/** A dependency-free dotted native path whose lexical root is `setState`. */
@:native("setState.Factory")
extern class NativeFactory {
  public function new();
}

/** A test-only authority that the negative lane deliberately omits. */
@:genesLexicalBindingMissingProbe
@:native("missingProbe.Factory")
extern class MissingProbeFactory {
  public function new();
}

/** A target type that must not become a runtime lexical authority. */
@:native("TypeOnlyRoot.Value")
extern class TypeOnlyValue {}

class Main {
  /** Covers direct native, constructor, checked-cast, host, function, and value roots. */
  static function runtimeRoots(value: Dynamic): Array<Dynamic> {
    final directType = NativeFactory;
    final hostType = js.lib.Error;
    final checked = cast(value, NativeFactory);
    return [
      directType,
      hostType,
      checked,
      new NativeFactory(),
      setStateFunction(),
      setStateValue
    ];
  }

  /** Authored target syntax marks only this exact sibling scope opaque. */
  static function opaqueSibling(): Void {
    js.Syntax.code("void setState");
  }

  /** The negative lane intentionally omits this exact constructor authority. */
  static function missingRegistrationProbe(): Void {
    #if genes.lexical_binding_missing_probe
    new MissingProbeFactory();
    #end
  }

  /** A retained type-only reference must not reserve `TypeOnlyRoot`. */
  @:keep
  static function typeOnly(value: TypeOnlyValue): TypeOnlyValue {
    return value;
  }

  static function main(): Void {
    runtimeRoots(null);
    opaqueSibling();
    missingRegistrationProbe();
    nestedDynamicBindings();
    deepFour();
    deepEight();
  }
}
