package servercase;

/** Reachable module whose body changes between warm requests. */
class Extra {
  public static function value(): String {
    return "extra-a-v1";
  }
}
