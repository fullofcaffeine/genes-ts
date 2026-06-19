enum SwitchValue {
  Text(value: String);
  Count(value: Int);
  Flag(value: Bool);
}

class Main {
  static function main(): Void {
    trace(render(Text("ok")) + ":" + render(Count(2)) + ":" + render(Flag(true)));
  }

  static function render(input: SwitchValue): String {
    return switch input {
      case Text(value):
        value;
      case Count(value):
        Std.string(value);
      case Flag(value):
        Std.string(value);
    }
  }
}
