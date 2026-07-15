package tests;

import genes.js.Async.await;
import js.lib.Promise as JsPromise;
import tink.core.Promise;

@:asserts
class TestAsyncAwait {
  public function new() {}

  @:async
  function addAsync(a: Int, b: Int): JsPromise<Int> {
    final x = await(JsPromise.resolve(a));
    final y = await(JsPromise.resolve(b));
    return x + y;
  }

  public function testAsyncMethod() {
    return Promise.ofJsPromise(addAsync(40, 2)).next(v -> {
      asserts.assert(v == 42);
      return asserts.done();
    });
  }

  public function testAsyncAnonFunction() {
    final fn = @:async function(a: Int): JsPromise<Int> {
      final v = @:await JsPromise.resolve(a);
      return v + 1;
    };

    return Promise.ofJsPromise(fn(41)).next(v -> {
      asserts.assert(v == 42);
      return asserts.done();
    });
  }

  @:async
  function voidAsync(flag: Array<Bool>): JsPromise<Void> {
    final v = await(JsPromise.resolve(true));
    if (v)
      flag[0] = true;
  }

  public function testAsyncVoidReturn() {
    final flag = [false];
    return Promise.ofJsPromise(voidAsync(flag)).next(_ -> {
      asserts.assert(flag[0] == true);
      return asserts.done();
    });
  }

  @:async
  function metadataAwaitAsync(a: Int, b: Int): JsPromise<Int> {
    final x = @:await JsPromise.resolve(a);
    final pending = JsPromise.resolve(b);
    final y = @:await pending;
    return x + y;
  }

  @:async
  function metadataAwaitVoid(flag: Array<Bool>): JsPromise<Void> {
    @:await JsPromise.resolve(null);
    flag[0] = true;
  }

  public function testMetadataAwait() {
    return Promise.ofJsPromise(metadataAwaitAsync(20, 22)).next(v -> {
      asserts.assert(v == 42);
      return asserts.done();
    });
  }

  public function testMetadataAwaitVoid() {
    final flag = [false];
    return Promise.ofJsPromise(metadataAwaitVoid(flag)).next(_ -> {
      asserts.assert(flag[0] == true);
      return asserts.done();
    });
  }

  @:async
  function metadataAwaitLocalScope(a: Int, b: Int): JsPromise<Int> {
    final px: JsPromise<Int> = JsPromise.resolve(a);
    final py: JsPromise<Int> = JsPromise.resolve(b);
    final x = @:await px;
    final y = @:await py;
    return x + y;
  }

  public function testMetadataAwaitLocalScope() {
    return Promise.ofJsPromise(metadataAwaitLocalScope(21, 21)).next(v -> {
      asserts.assert(v == 42);
      return asserts.done();
    });
  }

  /**
   * Why: JavaScript member access binds more tightly than `await`. Losing the
   * awaited expression's boundary would read `length` from the Promise and
   * await `undefined`, rather than reading it from the resolved array.
   *
   * What/How: keep property access directly on a metadata-style await so both
   * emitters must preserve `(await promise).length`; the runtime assertion is
   * the semantic oracle and catches output that merely parses successfully.
   */
  @:async
  function awaitedArrayLength(): JsPromise<Int> {
    return (@:await JsPromise.resolve([10, 20, 30])).length;
  }

  public function testAwaitedPropertyAccess() {
    return Promise.ofJsPromise(awaitedArrayLength()).next(length -> {
      asserts.assert(length == 3);
      return asserts.done();
    });
  }

  /**
   * Why: `@:async` must preserve method-local type parameters when it rewrites
   * generic functions. Downstream code often wraps critical sections and
   * resource lifetimes as `Promise<T>` helpers; losing `T` either breaks the
   * Haxe build or tempts callers toward `Dynamic`/`cast`.
   *
   * What/How: this fixture keeps `T` in the declared `Promise<T>` return type,
   * in the awaited local promise, and in the returned value. The async macro
   * should rewrite the method without resolving `T` outside the method's type
   * parameter scope.
   */
  @:async
  function genericIdentity<T>(value: T): JsPromise<T> {
    final pending: JsPromise<T> = JsPromise.resolve(value);
    final resolved = @:await pending;
    return resolved;
  }

  public function testGenericAsyncMethodTypeParameter() {
    return Promise.ofJsPromise(genericIdentity("typed")).next(v -> {
      asserts.assert(v == "typed");
      return asserts.done();
    });
  }

}
