import js.lib.Iterator.AsyncIterator;
import js.lib.Iterator.IteratorStep;
import js.lib.Promise;

class SymbolNumberStream {
  public function new() {}

  @:native("[Symbol.asyncIterator]")
  public function asyncIterator(): AsyncIterator<Int> {
    return {
      next: () -> Promise.resolve({value: 1, done: false}),
    };
  }
}

function nextFromNative(stream: SymbolNumberStream): Promise<IteratorStep<Int>> {
  return stream.asyncIterator().next();
}

function main(): Void {
  nextFromNative(new SymbolNumberStream());
}
