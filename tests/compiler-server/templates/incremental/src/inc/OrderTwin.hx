package inc;

/**
 * Two classes of one module with the same emitted name (genes-zt9w).
 * `Module.addTypes` keeps the first one in Haxe's list and skips the
 * other, so the list order decides which body is printed. Both give the
 * same line in the member list, so only the fingerprint, which keeps the
 * list order of declarations that can be members, sees the change.
 */
@:keep
@:native("OrderTwinX")
class OrderTwinA {
  public static function id(): String {
    return "A";
  }
}

@:keep
@:native("OrderTwinX")
class OrderTwinB {
  public static function id(): String {
    return "B";
  }
}
