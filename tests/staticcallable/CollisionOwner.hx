package tests.staticcallable;

/**
 * Supplies two different compiler declarations whose readable name is `T`.
 *
 * The class parameter and method parameter are intentionally unrelated. The
 * macro probe combines them into one planned callable signature to prove Genes
 * allocates `T` and `T_1` by declaration identity rather than collapsing them
 * by name.
 */
class CollisionOwner<T> {
  public static function identity<T>(value: T): T {
    return value;
  }
}
