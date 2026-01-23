package ts2hx;

enum abstract Color(Float) from Float to Float {
  var Red = 0;
  var Green = 2;
}

class Counter {
  public var value: Float;
  public function new(initial: Float) {
    this.value = initial;
  }
  public function inc(): Void {
    this.value = (this.value + 1);
  }
  public static function example(color: Color): Void {
    var c = new Counter(color);
    c.inc();
  }
}
