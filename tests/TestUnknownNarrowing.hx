package tests;

import genes.ts.Undefinable;
import genes.ts.Unknown;
import genes.ts.UnknownNarrow;
import tink.unit.Assert.*;

@:asserts
class TestUnknownNarrowing {
  public function new() {}

  public function testPrimitiveNarrowing() {
    asserts.assert(UnknownNarrow.string(Unknown.fromBoundary("Ada")) == "Ada");
    asserts.assert(UnknownNarrow.string(Unknown.fromBoundary(42)) == null);
    asserts.assert(UnknownNarrow.bool(Unknown.fromBoundary(true)) == true);
    asserts.assert(UnknownNarrow.number(Unknown.fromBoundary(Math.POSITIVE_INFINITY)) == Math.POSITIVE_INFINITY);
    asserts.assert(UnknownNarrow.finiteNumber(Unknown.fromBoundary(Math.POSITIVE_INFINITY)) == null);
    asserts.assert(UnknownNarrow.safeInteger(Unknown.fromBoundary(9007199254740991.0)) == 9007199254740991.0);
    asserts.assert(UnknownNarrow.int32(Unknown.fromBoundary(2147483647)) == 2147483647);
    asserts.assert(UnknownNarrow.int32(Unknown.fromBoundary(2147483648.0)) == null);
    return asserts.done();
  }

  public function testArrayAndRecordNarrowing() {
    final array = UnknownNarrow.array(Unknown.fromBoundary(["first", "second"]));
    if (array == null) {
      asserts.assert(false);
      return asserts.done();
    }
    asserts.assert(array.length == 2);
    asserts.assert(UnknownNarrow.string(array.get(0)) == "first");

    final record = UnknownNarrow.record(Unknown.fromBoundary({
      name: "Grace",
      age: 37
    }));
    if (record == null) {
      asserts.assert(false);
      return asserts.done();
    }
    asserts.assert(record.hasOwn("name"));
    asserts.assert(!record.hasOwn("missing"));
    asserts.assert(UnknownNarrow.string(record.get("name")) == "Grace");
    asserts.assert(UnknownNarrow.isUndefined(record.get("missing")));
    asserts.assert(record.keys().join(",") == "name,age");

    asserts.assert(UnknownNarrow.record(Unknown.fromBoundary(["not", "record"])) == null);
    return asserts.done();
  }

  public function testNullAndUndefinedChecks() {
    asserts.assert(UnknownNarrow.isNull(Unknown.fromBoundary(null)));
    asserts.assert(!UnknownNarrow.isUndefined(Unknown.fromBoundary(null)));
    asserts.assert(UnknownNarrow.isUndefined(Unknown.fromBoundary(Undefinable.absent())));
    return asserts.done();
  }
}
