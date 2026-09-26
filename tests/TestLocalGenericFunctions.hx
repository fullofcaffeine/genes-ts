package tests;

/** Local binders preserve inference, constraints, capture, and nested identity. */
@:asserts
class TestLocalGenericFunctions {
  public function new() {}

  public function testLocalBinders() {
    function identity<T>(value: T): T
      return value;
    function title<T: {title: String}>(value: T): String
      return value.title;
    function nested<T>(value: T): T {
      function inner<T>(item: T): T
        return item;
      final text: String = inner("text");
      if (text != "text")
        throw "Nested generic failed";
      return value;
    }
    final number: Int = identity(7);
    function repeat<T>(count: Int, value: T): T
      return count == 0 ? value : repeat(count - 1, value);
    final text: String = identity("seven");
    asserts.assert(number == 7);
    asserts.assert(text == "seven");
    asserts.assert(repeat(2, "value") == "value");
    asserts.assert(repeat(1, 7) == 7);
    asserts.assert(title({title: "named", count: 1}) == "named");
    asserts.assert(nested(4) == 4);
    asserts.assert(capture(9) == 9);
    asserts.assert(new GenericCapture("outer").read() == "outer");
    return asserts.done();
  }

  static function capture<T>(outer: T): T {
    function pair<T>(inner: T)
      return {outer: outer, inner: inner};
    final first = pair("value");
    final second = pair(12);
    if (first.inner != "value" || second.inner != 12)
      throw "Captured generic failed";
    return first.outer;
  }
}

private class GenericCapture<T> {
  final value: T;

  public function new(value: T)
    this.value = value;

  public function read(): T {
    final outer = value;
    function pair<T>(inner: T)
      return {outer: outer, inner: inner};
    return pair(1).outer;
  }
}
