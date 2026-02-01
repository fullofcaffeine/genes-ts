package ts2hx;

typedef Obj = { @:optional var value: Float; @:optional var nested: { @:optional var n: Float; @:optional var fn: Float->Float; }; };

function main(): Void {
  final obj: Obj = { value: 1, nested: { n: 2, fn: function(x: Float) return (x + 1) } };
  final nil: Obj = null;
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
  final f: Float->Float = function(x: Float) return (x * 2);
  trace((function() {
  var __ts2hx_fn11 = f;
  if (__ts2hx_fn11 == null) return null;
  return __ts2hx_fn11(3);
})());
  final g: Float->Float = null;
  trace((function() {
  var __ts2hx_fn12 = g;
  if (__ts2hx_fn12 == null) return null;
  return __ts2hx_fn12(3);
})());
  var v: Float = null;
  (function() {
  if (v == null) v = 10;
  return v;
})();
  trace(v);
  (function() {
  if (v == null) v = 11;
  return v;
})();
  trace(v);
  var b: Bool = null;
  (function() {
  if (b == null) b = true;
  return b;
})();
  trace(b);
  (function() {
  if (js.Syntax.code("!!{0}", b)) b = false;
  return b;
})();
  trace(b);
  (function() {
  if (!(js.Syntax.code("!!{0}", b))) b = true;
  return b;
})();
  trace(b);
}
