package tests.regroupidentity.status;

/**
 * Ordinary generic application type whose simple name matches a Tink helper.
 *
 * The compiler must identify this class by its typed Haxe declaration, not by
 * the unqualified `RegroupStatus` spelling. The focused TypeScript consumers
 * deliberately misuse `value` to prove the generated API retains `T`.
 */
class RegroupStatus<T> {
  public final value:T;

  public function new(value:T) {
    this.value = value;
  }
}
