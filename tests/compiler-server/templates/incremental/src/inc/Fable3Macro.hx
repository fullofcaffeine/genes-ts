package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * An init macro that reads the program after typing, in every request
 * (must fix 1 of the review of genes-ts #249, after the reviewer's probe).
 * When `inc.Leaf2` has the static `fableMixValue`, it writes
 * `@:value("lighter")` on the static `Light` of the implementation class of
 * the enum abstract `inc.FableMix.FableShade`; with `fableMixValueOnly`, it
 * writes `@:value("lightest")`.
 */
class Fable3Macro {
  public static function install(): Void {
    Context.onAfterTyping(types -> {
      var value: Null<String> = null;
      var impl: Null<ClassType> = null;
      for (type in types)
        switch type {
          case TClassDecl(ref):
            final cls = ref.get();
            if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
              for (field in cls.statics.get())
              if (field.name == 'fableMixValueOnly')
                value = 'lightest';
              else if (field.name == 'fableMixValue' && value == null)
                value = 'lighter';
          case TAbstract(ref):
            final abs = ref.get();
            if (abs.module == 'inc.FableMix' && abs.name == 'FableShade'
              && abs.impl != null) impl = abs.impl.get();
          default:
        }
      final wanted = value;
      if (wanted == null)
        return;
      final pos = Context.currentPos();
      final found = impl;
      if (found == null)
        Context.fatalError('Fable3Macro: no implementation of FableShade', pos);
      var done = false;
      for (field in found.statics.get())
        if (field.name == 'Light') {
          field.meta.remove(':value');
          field.meta.add(':value', [macro $v{wanted}], pos);
          done = true;
        }
      if (!done)
        Context.fatalError('Fable3Macro: no static Light', pos);
    });
  }
}
#end
