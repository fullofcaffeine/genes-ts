package ts2hx;

final INVALID_ATTRIBUTE_NAME: EReg = new EReg("[<>]", "");

function assertEqual(actual: String, expected: String, label: String): Void {
  if ((actual != expected))   {
    throw new js.lib.Error(("" + label + ": expected " + expected + ", got " + actual));
  }
}

function escapeMarkup(value: String): String {
  return (new EReg("<", "g")).replace((new EReg("&", "g")).replace(value, "&amp;"), "&lt;");
}

function isValidAttributeName(value: String): Bool {
  return !((INVALID_ATTRIBUTE_NAME).match(value));
}

function main(): Void {
  assertEqual(escapeMarkup("A & <B>"), "A &amp; &lt;B>", "replace");
  if (!(isValidAttributeName("data-id")))   {
    throw new js.lib.Error("valid attribute rejected");
  }
  if (isValidAttributeName("bad<name"))   {
    throw new js.lib.Error("invalid attribute accepted");
  }
  trace("MODULE_REGEXP_OK");
}
