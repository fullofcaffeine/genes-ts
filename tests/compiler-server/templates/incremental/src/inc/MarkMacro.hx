package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * An init macro that reads the whole program after typing, in every
 * request. When `inc.Leaf2` has a static `marker`, it adds `@:ts.returnType`
 * to `inc.MetaTarget.value`. Haxe does not type `inc.MetaTarget` again when
 * `inc.Leaf2` changes.
 */
class MarkMacro {
  static var wanted = false;
  static var target: Null<ClassField> = null;
  static var marked = false;

  public static function install(): Void {
    wanted = false;
    target = null;
    marked = false;
    Context.onAfterTyping(types -> {
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
                if (field.name == 'marker')
                  wanted = true;
            if (cls.module == 'inc.MetaTarget' && cls.name == 'MetaTarget')
              for (field in cls.statics.get())
              if (field.name == 'value')
                target = field;
          default:
        }
      final field = target;
      if (wanted && field != null && !marked) {
        marked = true;
        field.meta.remove(':ts.returnType');
        field.meta.add(':ts.returnType', [macro "string | null"],
          Context.currentPos());
      }
    });
  }
}
#end
