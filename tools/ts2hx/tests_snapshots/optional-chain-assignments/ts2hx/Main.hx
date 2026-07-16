package ts2hx;

typedef Obj = { @:optional @:ts.optional var value: Float; @:optional @:ts.optional var nested: { @:optional @:ts.optional var n: Float; @:optional @:ts.optional var fn: Float->Float; }; };

function nullableObj(value: Null<Obj>): Null<Obj> {
  return value;
}

function nullableFunction(value: Null<Float->Float>): Null<Float->Float> {
  return value;
}

function main(): Void {
  final obj: Null<Obj> = { value: 1, nested: { n: 2, fn: function(x: Float) return (x + 1) } };
  final nil = nullableObj(null);
  trace((function() {
  var __ts2hx_tmp0 = obj;
  return (__ts2hx_tmp0 == null ? null : __ts2hx_tmp0.value);
})());
  trace((function() {
  var __ts2hx_tmp1 = nil;
  return (__ts2hx_tmp1 == null ? null : __ts2hx_tmp1.value);
})());
  trace((function() {
  var __ts2hx_tmp3 = (function() {
  var __ts2hx_tmp2 = obj;
  return (__ts2hx_tmp2 == null ? null : __ts2hx_tmp2.nested);
})();
  return (__ts2hx_tmp3 == null ? null : __ts2hx_tmp3.n);
})());
  trace((function() {
  var __ts2hx_tmp5 = (function() {
  var __ts2hx_tmp4 = nil;
  return (__ts2hx_tmp4 == null ? null : __ts2hx_tmp4.nested);
})();
  return (__ts2hx_tmp5 == null ? null : __ts2hx_tmp5.n);
})());
  trace((function() {
  var __ts2hx_recv7 = (function() {
  var __ts2hx_tmp6 = obj;
  return (__ts2hx_tmp6 == null ? null : __ts2hx_tmp6.nested);
})();
  if (__ts2hx_recv7 == null) return null;
  var __ts2hx_fn8 = __ts2hx_recv7.fn;
  if (__ts2hx_fn8 == null) return null;
  return Reflect.callMethod(__ts2hx_recv7, __ts2hx_fn8, cast [1]);
})());
  trace((function() {
  var __ts2hx_recv9 = obj.nested;
  if (__ts2hx_recv9 == null) return null;
  var __ts2hx_fn10 = __ts2hx_recv9.fn;
  if (__ts2hx_fn10 == null) return null;
  return Reflect.callMethod(__ts2hx_recv9, __ts2hx_fn10, cast [2]);
})());
  final f: Null<Float->Float> = function(x: Float) return (x * 2);
  trace((function() {
  var __ts2hx_fn11 = f;
  if (__ts2hx_fn11 == null) return null;
  return __ts2hx_fn11(3);
})());
  final g = nullableFunction(null);
  trace((function() {
  var __ts2hx_fn12 = g;
  if (__ts2hx_fn12 == null) return null;
  return __ts2hx_fn12(3);
})());
  var v: Null<Float> = null;
  (function() {
  var __ts2hx_current13 = v;
  if (__ts2hx_current13 == null) {
    __ts2hx_current13 = 10;
    v = __ts2hx_current13;
  }
  return __ts2hx_current13;
})();
  trace(v);
  (function() {
  var __ts2hx_current14 = v;
  if (__ts2hx_current14 == null) {
    __ts2hx_current14 = 11;
    v = __ts2hx_current14;
  }
  return __ts2hx_current14;
})();
  trace(v);
  var b: Null<Bool> = null;
  (function() {
  var __ts2hx_current15 = b;
  if (__ts2hx_current15 == null) {
    __ts2hx_current15 = true;
    b = __ts2hx_current15;
  }
  return __ts2hx_current15;
})();
  trace(b);
  (function() {
  var __ts2hx_current16 = b;
  if (genes.js.Truthiness.isTruthy(__ts2hx_current16)) {
    __ts2hx_current16 = false;
    b = __ts2hx_current16;
  }
  return __ts2hx_current16;
})();
  trace(b);
  (function() {
  var __ts2hx_current17 = b;
  if (!(genes.js.Truthiness.isTruthy(__ts2hx_current17))) {
    __ts2hx_current17 = true;
    b = __ts2hx_current17;
  }
  return __ts2hx_current17;
})();
  trace(b);
}
