package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * An init macro that reads the program after typing, in every request
 * (genes-f8vc.9.23). While `inc.Leaf2` has the static `argMetaType`, it
 * writes `@:ts.type("string")` on the local variable of the argument `count`
 * of `inc.ArgMeta.show`; otherwise it removes that metadata.
 *
 * The metadata lives in the typed body of `show` (a `TVar`), so Haxe does
 * not type `inc.ArgMeta` again and no clean rule sees the change. This is
 * limit L3 of the round-3 review of genes-ts #244, which the rolling replay
 * audit covers by comparing bytes.
 */
class ArgMetaMacro {
  public static function install(): Void {
    Context.onAfterTyping(types -> {
      var wanted = false;
      var method: Null<ClassField> = null;
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
                if (field.name == 'argMetaType')
                  wanted = true;
            if (cls.module == 'inc.ArgMeta' && cls.name == 'ArgMeta')
              for (field in cls.statics.get())
              if (field.name == 'show')
                method = field;
          default:
        }
      final field = method;
      if (field == null)
        return;
      final body = field.expr();
      if (body == null)
        return;
      switch body.expr {
        case TFunction(fn):
          for (argument in fn.args)
            if (argument.v.name == 'count') {
              final meta = argument.v.meta;
              if (meta == null)
                continue;
              final present = meta.has(':ts.type');
              if (present && !wanted)
                meta.remove(':ts.type');
              if (!present && wanted)
                meta.add(':ts.type', [macro "string"], Context.currentPos());
            }
        default:
      }
    });
  }
}
#end
