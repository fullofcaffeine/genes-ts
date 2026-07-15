package dual;

/** Unreachable sentinel whose absence is part of the bounded shape snapshot. */
class DeadCode {
  public static function mustNotEmit():String {
    return "dead";
  }
}
