package ts2hx;

typedef Nested = { @:optional var c: String; };

typedef Obj = { @:optional var a: Float; @:optional var b: Nested; @:optional var d: Float; @:optional var e: Float; };

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
  x = __ts2hx_tmp7.a;
  return null;
})());
  var y = "missing";
  ((function() {
  var __ts2hx_tmp8 = obj;
  var __ts2hx_tmp9 = __ts2hx_tmp8.b;
  var __ts2hx_tmp10: Dynamic = (__ts2hx_tmp9 == null ? {  } : __ts2hx_tmp9);
  y = __ts2hx_tmp10.c;
  return null;
})());
  final arr = [10, 20, 30, 40];
  final __ts2hx_tmp11 = arr;
  var __ts2hx_tmp12 = __ts2hx_tmp11[0];
  final first = __ts2hx_tmp12;
  var __ts2hx_tmp13 = __ts2hx_tmp11[2];
  final third = (__ts2hx_tmp13 == null ? 33 : __ts2hx_tmp13);
  final tail = __ts2hx_tmp11.slice(3);
  var second: Float = 0;
  ((function() {
  var __ts2hx_tmp14 = arr;
  second = __ts2hx_tmp14[1];
  return null;
})());
  final take = function(?_p0: Obj) {
  if (_p0 == null) _p0 = {  };
  var __ts2hx_tmp15 = _p0;
  var __ts2hx_tmp16 = __ts2hx_tmp15.a;
  var a = (__ts2hx_tmp16 == null ? 7 : __ts2hx_tmp16);
  var __ts2hx_tmp17 = __ts2hx_tmp15.b;
  var __ts2hx_tmp18: Dynamic = (__ts2hx_tmp17 == null ? {  } : __ts2hx_tmp17);
  var __ts2hx_tmp19 = __ts2hx_tmp18.c;
  var c = __ts2hx_tmp19;
  final suffix = ((c == null) ? "none" : c);
  return ("" + a + ":" + suffix);
};
  take(obj);
}
