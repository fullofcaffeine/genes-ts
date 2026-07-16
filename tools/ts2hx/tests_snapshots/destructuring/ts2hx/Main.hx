package ts2hx;

typedef Nested = { @:optional @:ts.optional var c: String; };

typedef Obj = { @:optional @:ts.optional var a: Float; @:optional @:ts.optional var b: Nested; @:optional @:ts.optional var d: Float; @:optional @:ts.optional var e: Float; };

function main(): Void {
  final obj: Obj = { a: 1, b: { c: "hi" }, d: 4, e: 5 };
  final __ts2hx_tmp0 = obj;
  var __ts2hx_tmp1 = __ts2hx_tmp0.a;
  final a = __ts2hx_tmp1;
  var __ts2hx_tmp2 = __ts2hx_tmp0.b;
  var __ts2hx_tmp3: Dynamic = (__ts2hx_tmp2 == null ? {  } : __ts2hx_tmp2);
  var __ts2hx_tmp4 = __ts2hx_tmp3.c;
  final c = (__ts2hx_tmp4 == null ? "fallback" : __ts2hx_tmp4);
  final rest = js.lib.Object.assign(cast {}, __ts2hx_tmp0);
  Reflect.deleteField(rest, "a");
  Reflect.deleteField(rest, "b");
  final __ts2hx_tmp5 = obj;
  var __ts2hx_tmp6 = __ts2hx_tmp5.d;
  final dd = (__ts2hx_tmp6 == null ? 9 : __ts2hx_tmp6);
  var x: Float = 0;
  ((function() {
  var __ts2hx_tmp7 = obj;
  var __ts2hx_tmp8 = __ts2hx_tmp7.a;
  x = (__ts2hx_tmp8 == null ? 0 : __ts2hx_tmp8);
  return __ts2hx_tmp7;
})());
  var y = "missing";
  ((function() {
  var __ts2hx_tmp9 = obj;
  var __ts2hx_tmp10 = __ts2hx_tmp9.b;
  var __ts2hx_tmp11: Dynamic = (__ts2hx_tmp10 == null ? { c: "missing" } : __ts2hx_tmp10);
  var __ts2hx_tmp12 = __ts2hx_tmp11.c;
  y = (__ts2hx_tmp12 == null ? "missing" : __ts2hx_tmp12);
  return __ts2hx_tmp9;
})());
  final arr = [10, 20, 30, 40];
  final __ts2hx_tmp13 = arr;
  var __ts2hx_tmp14 = __ts2hx_tmp13[0];
  final first = __ts2hx_tmp14;
  var __ts2hx_tmp15 = __ts2hx_tmp13[2];
  final third = (__ts2hx_tmp15 == null ? 33 : __ts2hx_tmp15);
  final tail = __ts2hx_tmp13.slice(3);
  var second: Float = 0;
  ((function() {
  var __ts2hx_tmp16 = arr;
  second = __ts2hx_tmp16[1];
  return __ts2hx_tmp16;
})());
  final take = function(?_p0: genes.ts.Undefinable<Obj>) {
  if (genes.ts.Undefinable.isAbsent(_p0)) _p0 = {  };
  var __ts2hx_tmp17 = _p0.assumePresent();
  var __ts2hx_tmp18 = __ts2hx_tmp17.a;
  var a = (__ts2hx_tmp18 == null ? 7 : __ts2hx_tmp18);
  var __ts2hx_tmp19 = __ts2hx_tmp17.b;
  var __ts2hx_tmp20: Dynamic = (__ts2hx_tmp19 == null ? {  } : __ts2hx_tmp19);
  var __ts2hx_tmp21 = __ts2hx_tmp20.c;
  var c = __ts2hx_tmp21;
  final suffix = ((c == null) ? "none" : c);
  return ("" + a + ":" + suffix);
};
  take(obj);
}
