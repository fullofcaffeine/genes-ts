package inc;

/** Review probe (round 3): a module of one extern class only. */
@:native("globalThis")
extern class ExtApi {
  static function parseInt(text: String): Float;
}
