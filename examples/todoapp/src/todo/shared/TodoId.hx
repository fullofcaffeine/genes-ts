package todo.shared;

abstract TodoId(String) from String to String {
  public inline function new(value: String)
    this = value;

  public static function create(): TodoId {
    final now: Float = cast js.Syntax.code("Date.now()");
    final rnd = Std.random(0x7fffffff);
    return new TodoId('${Std.int(now)}-$rnd');
  }
}

