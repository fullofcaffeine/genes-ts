package foo;

import genes.js.Async.await;
import js.lib.Promise;

class AsyncFoo {
  public function new() {}

  @:async
  public function plusOneAsync(x: Int): Promise<Int> {
    final v = @:await Promise.resolve(x);
    return v + 1;
  }

  @:async
  public function doubleWithAwaitMacro(x: Int): Promise<Int> {
    final v = await(Promise.resolve(x));
    return v * 2;
  }

  @:async
  public function metadataAwaitLocalScope(x: Int): Promise<Int> {
    final pending: Promise<Int> = Promise.resolve(x);
    final v: Int = @:await pending;
    return v + 3;
  }

  public static function demo(): Promise<Int> {
    return new AsyncFoo().plusOneAsync(41);
  }
}
