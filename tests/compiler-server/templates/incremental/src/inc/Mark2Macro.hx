package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * An init macro that reads the program after typing, in every request
 * (genes-f8vc.9.24, from the round-3 review of genes-ts #244). For each
 * static of `inc.Leaf2` named below, it writes metadata on a declaration of
 * another module that Haxe does not type again:
 *
 * - `markExtern`: `@:native("parseFloat")` on the extern field
 *   `inc.ExtApi.parseInt`;
 * - `markAnon`: `@:ts.type("string")` on the field `x` of the anonymous
 *   structure of the typedef `inc.Chain.ChainB`;
 * - `markAnonVar`, `markAnonArg`, `markAnonResult`, `markAnonParam`:
 *   `@:ts.type("string")` on a field of an anonymous structure in the type
 *   of a field of `inc.AnonSig` (a variable type, an argument, a result,
 *   and a type argument).
 */
class Mark2Macro {
  public static function install(): Void {
    Context.onAfterTyping(types -> {
      final marks = new Map<String, Bool>();
      var externField: Null<ClassField> = null;
      var chain: Null<Type> = null;
      final anonSig = new Map<String, ClassField>();
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
                marks.set(field.name, true);
            if (cls.module == 'inc.ExtApi' && cls.name == 'ExtApi')
              for (field in cls.statics.get())
                if (field.name == 'parseInt')
                  externField = field;
            if (cls.module == 'inc.AnonSig' && cls.name == 'AnonSig')
              for (field in cls.statics.get())
              anonSig.set(field.name, field);
          case TTypeDecl(ref):
            final def = ref.get();
            if (def.module == 'inc.Chain' && def.name == 'ChainB')
              chain = def.type;
          default:
        }
      final pos = Context.currentPos();
      function mark(type: Null<Type>, name: String): Void {
        switch type {
          case TAnonymous(anon):
            for (field in anon.get().fields)
              if (field.name == name) {
                field.meta.remove(':ts.type');
                field.meta.add(':ts.type', [macro "string"], pos);
              }
          case TInst(_, [param]):
            mark(param, name);
          case TFun(args, result):
            for (arg in args)
              mark(arg.t, name);
            mark(result, name);
          case TLazy(get):
            mark(get(), name);
          default:
        }
      }
      function fieldType(name: String): Null<Type> {
        final field = anonSig.get(name);
        return field == null ? null : field.type;
      }
      final field = externField;
      if (marks.exists('markExtern') && field != null) {
        field.meta.remove(':native');
        field.meta.add(':native', [macro "parseFloat"], pos);
      }
      if (marks.exists('markAnon'))
        mark(chain, 'x');
      if (marks.exists('markAnonVar'))
        mark(fieldType('point'), 'x');
      if (marks.exists('markAnonArg'))
        mark(fieldType('take'), 'y');
      if (marks.exists('markAnonResult'))
        mark(fieldType('make'), 'z');
      if (marks.exists('markAnonParam'))
        mark(fieldType('rows'), 'w');
    });
  }
}
#end
