package ts2hx;

typedef Nested = { @:optional @:ts.optional var c: String; };

typedef Obj = { @:optional @:ts.optional var a: Float; @:optional @:ts.optional var b: Nested; @:optional @:ts.optional var d: Float; @:optional @:ts.optional var e: Float; @:optional @:ts.optional var nullable: Null<Float>; };

function main(): Void {
  final obj: Obj = { a: 1, b: { c: "hi" }, d: 4, e: 5, nullable: null };
  final __ts2hx_tmp0 = obj;
  var __ts2hx_tmp1 = __ts2hx_tmp0.a;
  final a = __ts2hx_tmp1;
  var __ts2hx_tmp2 = __ts2hx_tmp0.b;
  var __ts2hx_tmp3: Dynamic = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp2) ? {  } : genes.ts.Present.require(__ts2hx_tmp2));
  var __ts2hx_tmp4 = __ts2hx_tmp3.c;
  final c = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp4) ? "fallback" : genes.ts.Present.require(__ts2hx_tmp4));
  final rest = js.lib.Object.assign(cast {}, __ts2hx_tmp0);
  Reflect.deleteField(rest, "a");
  Reflect.deleteField(rest, "b");
  final __ts2hx_tmp5 = obj;
  var __ts2hx_tmp6 = __ts2hx_tmp5.d;
  final dd = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp6) ? 9 : genes.ts.Present.require(__ts2hx_tmp6));
  final __ts2hx_tmp7 = obj;
  var __ts2hx_tmp8 = __ts2hx_tmp7.nullable;
  final nullable = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp8) ? 12 : __ts2hx_tmp8);
  if (!(genes.js.Equality.strict(nullable, null)))   {
    throw new js.lib.Error("destructuring default replaced null");
  }
  var x: Float = 0;
  ((function() {
  var __ts2hx_tmp9 = obj;
  var __ts2hx_tmp10 = __ts2hx_tmp9.a;
  x = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp10) ? 0 : genes.ts.Present.require(__ts2hx_tmp10));
  return __ts2hx_tmp9;
})());
  var y = "missing";
  ((function() {
  var __ts2hx_tmp11 = obj;
  var __ts2hx_tmp12 = __ts2hx_tmp11.b;
  var __ts2hx_tmp13: Dynamic = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp12) ? { c: "missing" } : genes.ts.Present.require(__ts2hx_tmp12));
  var __ts2hx_tmp14 = __ts2hx_tmp13.c;
  y = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp14) ? "missing" : genes.ts.Present.require(__ts2hx_tmp14));
  return __ts2hx_tmp11;
})());
  final arr = [10, 20, 30, 40];
  final __ts2hx_tmp15 = arr;
  var __ts2hx_tmp16 = __ts2hx_tmp15[0];
  final first = __ts2hx_tmp16;
  var __ts2hx_tmp17 = __ts2hx_tmp15[2];
  final third = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp17) ? 33 : genes.ts.Present.require(__ts2hx_tmp17));
  final tail = __ts2hx_tmp15.slice(3);
  var second: Float = 0;
  ((function() {
  var __ts2hx_tmp18 = arr;
  second = __ts2hx_tmp18[1];
  return __ts2hx_tmp18;
})());
  final take = function(?_p0: genes.ts.Undefinable<Obj>) {
  if (genes.ts.Undefinable.isAbsent(_p0)) _p0 = {  };
  var __ts2hx_tmp19 = _p0.assumePresent();
  var __ts2hx_tmp20 = __ts2hx_tmp19.a;
  var a = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp20) ? 7 : genes.ts.Present.require(__ts2hx_tmp20));
  var __ts2hx_tmp21 = __ts2hx_tmp19.b;
  var __ts2hx_tmp22: Dynamic = (genes.ts.Undefinable.isAbsent(__ts2hx_tmp21) ? {  } : genes.ts.Present.require(__ts2hx_tmp21));
  var __ts2hx_tmp23 = __ts2hx_tmp22.c;
  var c = __ts2hx_tmp23;
  final suffix = ((c == null) ? "none" : c);
  return ("" + a + ":" + suffix);
};
  take(obj);
}
