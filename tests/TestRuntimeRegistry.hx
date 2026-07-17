package tests;

import genes.Register;
import genes.ts.Unknown;
import genes.ts.UnknownNarrow;

/**
 * Proves that Genes runtime registries behave like string-keyed dictionaries.
 *
 * JavaScript object prototypes already define names such as `constructor`,
 * `toString`, and `__proto__`. Those names are valid registry keys, so the
 * runtime must not mistake inherited built-ins for registries created by
 * Genes. This focused fixture also checks the ordinary same-name and
 * different-name identity contract used by `$hxClasses` and `$hxEnums`.
 */
@:asserts
class TestRuntimeRegistry {
  public function new() {}

  public function testNamedRegistryIdentity() {
    final ordinaryA = Register.global("tests.runtime-registry.ordinary");
    final ordinaryB = Register.global("tests.runtime-registry.ordinary");
    final separate = Register.global("tests.runtime-registry.separate");

    asserts.assert(ordinaryA == ordinaryB);
    asserts.assert(ordinaryA != separate);
    asserts.assert(!ordinaryA.exists("missing"));
    return asserts.done();
  }

  public function testPrototypeNamesRemainOrdinaryKeys() {
    final constructorRegistry = Register.global("constructor");
    final toStringRegistry = Register.global("toString");
    final prototypeRegistry = Register.global("__proto__");

    // A missing DynamicAccess read is `undefined` in classic JS and normalized
    // to `null` in genes-ts. Haxe's nullish equality states that shared
    // contract directly and still rejects every inherited built-in here.
    final constructorIsMissing:Bool = constructorRegistry.get("toString") == null;
    final toStringIsMissing:Bool = toStringRegistry.get("constructor") == null;
    final prototypeIsMissing:Bool = prototypeRegistry.get("toString") == null;
    asserts.assert(constructorIsMissing);
    asserts.assert(toStringIsMissing);
    asserts.assert(prototypeIsMissing);

    constructorRegistry.set("marker", "constructor");
    toStringRegistry.set("marker", "toString");
    prototypeRegistry.set("marker", "prototype");

    asserts.assert(UnknownNarrow.string(Unknown.fromBoundary(
      Register.global("constructor").get("marker"))) == "constructor");
    asserts.assert(UnknownNarrow.string(Unknown.fromBoundary(
      Register.global("toString").get("marker"))) == "toString");
    asserts.assert(UnknownNarrow.string(Unknown.fromBoundary(
      Register.global("__proto__").get("marker"))) == "prototype");
    return asserts.done();
  }
}
