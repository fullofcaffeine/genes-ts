package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * An init macro that reads the program after typing, in every request
 * (genes-f8vc.9.27). For each static of `inc.Leaf2` named below it writes
 * metadata on a declaration that dead-code elimination removes, so that it
 * is in no generator list:
 *
 * - `unlistedOverride` (M2a of the review of genes-ts #246): sets
 *   `@:ts.type("string")` on the class `inc.TsTyped.TsTyped`;
 * - `unlistedValue` (M2b): sets `@:value("lighter")` on the static `Light`
 *   of the implementation class of the enum abstract `inc.Shade`.
 *
 * Haxe types neither module again, and the printers of `inc.TsTypedUser`
 * and `inc.ShadeUser` print the metadata.
 */
class UnlistedMacro {
  public static function install(): Void {
    Context.onAfterTyping(types -> {
      final marks = new Map<String, Bool>();
      var tsTyped: Null<ClassType> = null;
      var shadeImpl: Null<ClassType> = null;
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
                marks.set(field.name, true);
            if (cls.module == 'inc.TsTyped' && cls.name == 'TsTyped')
              tsTyped = cls;
          case TAbstract(ref):
            final abs = ref.get();
            if (abs.module == 'inc.Shade' && abs.name == 'Shade'
              && abs.impl != null) shadeImpl = abs.impl.get();
          default:
        }
      final pos = Context.currentPos();
      if (marks.exists('unlistedOverride')) {
        final cls = tsTyped;
        if (cls == null)
          Context.fatalError('UnlistedMacro: no class inc.TsTyped', pos);
        cls.meta.remove(':ts.type');
        cls.meta.add(':ts.type', [macro "string"], pos);
      }
      if (marks.exists('unlistedValue')) {
        final impl = shadeImpl;
        if (impl == null)
          Context.fatalError('UnlistedMacro: no implementation of inc.Shade',
            pos);
        var done = false;
        for (field in impl.statics.get())
          if (field.name == 'Light') {
            field.meta.remove(':value');
            field.meta.add(':value', [macro "lighter"], pos);
            done = true;
          }
        if (!done)
          Context.fatalError('UnlistedMacro: no static Light in inc.Shade',
            pos);
      }
    });
  }
}
#end
