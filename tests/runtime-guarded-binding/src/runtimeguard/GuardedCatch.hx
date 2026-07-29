package runtimeguard;

/**
 * Exercises opaque enum catches and native class catches from ordinary Haxe.
 *
 * Haxe owns the runtime guard and enters a catch arm only after it succeeds.
 * The nested conditional proves that the enum binding stays valid throughout
 * the true branch without turning the plan into mutable emitter flow state.
 */
class GuardedCatch {
  public static function recover(kind: String): String {
    try {
      if (kind == "enum")
        throw GuardedFailure.Rejected("enum-caught");
      if (kind == "class")
        throw new NativeFailure("class-caught");
      throw "plain";
    } catch (failure:GuardedFailure) {
      return if (kind == "enum") {
        switch failure {
          case Rejected(message): message;
        }
      } else {
        "unreachable-enum";
      };
    } catch (failure:NativeFailure) {
      return failure.message;
    } catch (_:haxe.Exception) {
      return "fallback";
    }
  }
}
