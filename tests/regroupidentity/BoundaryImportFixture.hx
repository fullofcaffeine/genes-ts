package tests.regroupidentity;

/**
 * Generic interface used to prove concrete-to-parent boundary projection.
 *
 * Both reading and writing mention `T`, so TypeScript cannot safely treat
 * `BoundaryCarrier<T | null>` as `BoundaryCarrier<T>`.
 */
interface BoundaryCarrier<T> {
  public function read(): T;
  public function write(value: T): Void;
}

/** Type named only by the planned assertion in the calling module. */
class BoundaryOnlyTarget {
  public final label: String;

  public function new(label: String) {
    this.label = label;
  }
}

/** Concrete implementation whose parent applies a nullable payload. */
class BoundaryNullableCarrier implements BoundaryCarrier<Null<BoundaryOnlyTarget>> {
  var value: Null<BoundaryOnlyTarget>;

  public function new(value: Null<BoundaryOnlyTarget>) {
    this.value = value;
  }

  public function read(): Null<BoundaryOnlyTarget> {
    return value;
  }

  public function write(value: Null<BoundaryOnlyTarget>): Void {
    this.value = value;
  }
}

/**
 * Keeps parent and payload types out of the caller's authored signatures.
 *
 * The caller sees only these two static methods. Its generated assertion is
 * therefore the sole reason it needs `BoundaryCarrier` and
 * `BoundaryOnlyTarget` as type-only imports.
 */
class BoundaryImportFactory {
  public static function nullable(): BoundaryNullableCarrier {
    return new BoundaryNullableCarrier(new BoundaryOnlyTarget("planned"));
  }

  public static function accept(value: BoundaryCarrier<BoundaryOnlyTarget>): String {
    return value.read().label;
  }
}
