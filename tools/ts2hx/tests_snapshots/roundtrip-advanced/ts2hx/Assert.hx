package ts2hx;

function assert(condition: Bool, message: String): Void {
  if (!(condition))   {
    throw new js.lib.Error(message);
  }
}

function assertEqual(actual: Float, expected: Float, label: String): Void {
  if ((actual != expected))   {
    throw new js.lib.Error(("" + label + ": expected " + expected + ", got " + actual));
  }
}

function assertStringEqual(actual: String, expected: String, label: String): Void {
  if ((actual != expected))   {
    throw new js.lib.Error(("" + label + ": expected " + haxe.Json.stringify(expected) + ", got " + haxe.Json.stringify(actual)));
  }
}
