package tests.staticcallable;

/**
 * Package-neutral reproduction for a free generic retained by Haxe inference.
 *
 * `wrap` declares no type parameter in source. Its final typed signature is
 * specialized through `StaticCallableSignatureApi.create<T>`, however, so
 * Genes must declare that retained parameter on the generated static method.
 */
@:keep
class InferredStaticFactory<T> {
  final payload: InferredStaticPayload<T>;

  public function new(payload: InferredStaticPayload<T>) {
    this.payload = payload;
  }

  @:keep
  public static function wrap(payload) {
    return new InferredStaticFactory(payload);
  }

  public function read(): T {
    return payload.value;
  }
}

@:keep
class InferredStaticPayload<T> {
  public final value: T;

  public function new(value: T) {
    this.value = value;
  }
}

@:keep
class StaticCallableSignatureApi {
  public static function create<T>(value: T): InferredStaticFactory<T> {
    return InferredStaticFactory.wrap(new InferredStaticPayload(value));
  }

  /** An ordinary declared method generic must remain declared exactly once. */
  public static function ordinary<T>(value: T): T {
    return value;
  }
}
