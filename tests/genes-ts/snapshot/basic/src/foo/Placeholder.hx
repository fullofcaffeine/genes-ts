package foo;

// Test helper: ensure genes-ts supports placeholder substitution in `@:ts.type`
// overrides. `$0` expands to the first concrete type argument at the use site.
@:ts.type("ReadonlyArray<$0>")
abstract ReadonlyVec<T>(Array<T>) from Array<T> to Array<T> {}

class Placeholder {
  public static function demo(): ReadonlyVec<Int> {
    return [1, 2, 3];
  }
}

