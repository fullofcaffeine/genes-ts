package servercase;

#if server_intrinsic_provider
/** The first callback payload of `IntrinsicProvider` (see that module). */
typedef PingA = {
  final a: Int;
}

/** The callback payload after the edit of `IntrinsicProvider`. */
typedef PingB = {
  final a: Int;
}

/** Receives the payload, so that the callback body reads a field of it. */
class IntrinsicSink {
  public static var last = 0;

  public static function take(value: Int): Void {
    last = value;
  }
}
#end
