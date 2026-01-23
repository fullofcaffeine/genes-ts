package foo;

import genes.js.Async.await;
import js.lib.Promise;

class AsyncFoo {
  public function new() {}

  @:async
  public function plusOneAsync(x: Int): Promise<Int> {
    final v = await(Promise.resolve(x));
    return v + 1;
  }

  public static function demo(): Promise<Int> {
    return new AsyncFoo().plusOneAsync(41);
  }
}

