package ts2hx;

function plusOne(x: Float): js.lib.Promise<Float> {
  return __Ts2hxAsync.plusOne(x);
}

function run(): js.lib.Promise<Float> {
  return __Ts2hxAsync.run();
}

function main(): Void {
  run().then(function(v: Float) return trace(v));
}

private class __Ts2hxAsync {
  public static final plusOne = @:async function(x: Float): js.lib.Promise<Float> {
  final v = genes.js.Async.await(js.lib.Promise.resolve(x));
  return (v + 1);
};
  public static final run = @:async function(): js.lib.Promise<Float> {
  try {
    final out = genes.js.Async.await(plusOne(1));
    return out;
  } catch (_e: Any) {
    return -(1);
  }
};
}
