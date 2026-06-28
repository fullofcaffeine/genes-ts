package foo;

import genes.js.Async.await;
import js.lib.Promise;

typedef AsyncOptionalLabelRecord = {
  @:optional final label:String;
}

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

  static function promiseLabel(value: Null<String>): Promise<String> {
    return Promise.resolve(value == null ? "missing" : value);
  }

  @:async
  static function privateDoubleAsync(x: Int): Promise<Int> {
    final value = @:await Promise.resolve(x);
    return value * 2;
  }

  @:async
  public function metadataAwaitOptionalParam(record: AsyncOptionalLabelRecord): Promise<String> {
    return @:await promiseLabel(record.label);
  }

  public static function demo(): Promise<Int> {
    return new AsyncFoo().plusOneAsync(41);
  }

  public static function demoPrivateStaticAsync(): Promise<Int> {
    return privateDoubleAsync(21);
  }
}
