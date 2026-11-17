package inc;

/**
 * A module to which Haxe adds a class without typing the module again
 * (must fix 1 of the review of genes-ts #249, the reviewer's fixture). The
 * first use of an inline method of an extern class as a value makes Haxe
 * add a wrapper class for it to this module (`wrap_extern` in Haxe's
 * `calls.ml`).
 */
extern class FableMix {
  public static inline function twice(value: Int): Int {
    return value * 2;
  }
}

/**
 * An enum abstract of the same module; `inc.FableMixUser` prints its type.
 * `inc.Fable3Macro` writes `:value` metadata on `Light`.
 */
enum abstract FableShade(String) {
  var Light = "light";
  var Dark = "dark";
}
