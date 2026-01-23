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
      final v = await(JsPromise.resolve(a));
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
}

