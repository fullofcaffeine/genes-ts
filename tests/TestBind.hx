package tests;

@:asserts
class TestBind {
  public function new() {}

  function test(a, b)
    return a + b;

  dynamic function foo(): String
    return 'foo';

  static function notNull(f: () -> String)
    return f != null;

  static function run(f: () -> String)
    return if (f != null) f() else 'null';

  // benmerckx/genes#10
  public function testInstanceMethodBind() {
    asserts.assert(notNull(foo));
    asserts.assert(run(foo) == 'foo');
    foo = null;
    asserts.assert(!notNull(foo));
    asserts.assert(run(foo) == 'null');
    foo = () -> 'foo';
    return asserts.done();
  }

  public function testInstanceMethodBindFromFieldAccess() {
    function exec(o: {test: TestBind}) {
      asserts.assert(notNull(o.test.foo));
      asserts.assert(run(o.test.foo) == 'foo');
      o.test.foo = null;
      asserts.assert(!notNull(o.test.foo));
      asserts.assert(run(o.test.foo) == 'null');
      return asserts.done();
    }

    return exec({test: this});
  }

  public function testBind() {
    function test(a, b)
      return a + b;
    final t = new TestBind();
    asserts.assert(test.bind(1)(2) == 3);
    asserts.assert(t.test.bind(_, 1)(2) == 3);
    asserts.assert((test(1, 1) == 2 ? test : t.test).bind(_, 1)(2) == 3);
    asserts.assert((Reflect.field(t, 'test') : Int->Int->Int).bind(1)(2) == 3);
    return asserts.done();
  }

  public function testBoundClosureCacheIdentity() {
    final left = new BoundReceiver("left");
    final right = new BoundReceiver("right");

    final leftFirstA = left.first;
    final leftFirstB = left.first;
    final leftSecond = left.second;
    final rightFirst = right.first;

    // Re-reading one method is stable, while either the receiver or method
    // identity creates a separate cached closure.
    asserts.assert(leftFirstA == leftFirstB);
    asserts.assert(leftFirstA != leftSecond);
    asserts.assert(leftFirstA != rightFirst);
    asserts.assert(leftFirstA("!") == "left:first!");
    asserts.assert(leftSecond("!") == "left:second!");
    asserts.assert(rightFirst("!") == "right:first!");
    return asserts.done();
  }

  public function testInheritedAndOverriddenBoundMethods() {
    final base = new BoundBase("base");
    final child = new BoundChild("child");

    final baseDescribe = base.describe;
    final childDescribeA = child.describe;
    final childDescribeB = child.describe;
    final inherited = child.inherited;

    asserts.assert(baseDescribe() == "base:base");
    asserts.assert(childDescribeA() == "override:child");
    asserts.assert(childDescribeA == childDescribeB);
    asserts.assert(baseDescribe != childDescribeA);
    asserts.assert(inherited() == "inherited:child");
    return asserts.done();
  }
}

private class BoundReceiver {
  final label:String;

  public function new(label:String) {
    this.label = label;
  }

  public function first(suffix:String):String {
    return '$label:first$suffix';
  }

  public function second(suffix:String):String {
    return '$label:second$suffix';
  }
}

private class BoundBase {
  public final label:String;

  public function new(label:String) {
    this.label = label;
  }

  public function describe():String {
    return 'base:$label';
  }

  public function inherited():String {
    return 'inherited:$label';
  }
}

private class BoundChild extends BoundBase {
  public function new(label:String) {
    super(label);
  }

  override public function describe():String {
    return 'override:$label';
  }
}
