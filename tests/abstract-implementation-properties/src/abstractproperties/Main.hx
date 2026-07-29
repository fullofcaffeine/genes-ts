package abstractproperties;

class Main {
  public static function main(): Void {
    final readable = new Readable("read");
    final writable = new Writable(1);
    writable.writable = 7;
    final readWrite = new ReadWrite("before");
    readWrite.current = "after";
    final plain = new Plain(9);
    final staticControl = new StaticControl("value");

    NodeConsole.log([
      readable.readable,
      Std.string(writable.current()),
      readWrite.current,
      Std.string(plain.plain),
      StaticControl.label,
      staticControl.value()
    ].join("|"));
  }
}
