package inc;

#if macro
import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Makes an enum of `inc.ExclOwner` extern with `exclude()` in an
 * after-typing callback, when `inc.Leaf2` has a static that asks for it.
 * Haxe types neither `inc.ExclOwner` nor `inc.ExclHintUser` again, so no stamp
 * changes, and no metadata changes. The walk of reachability then takes no
 * step from `inc.ExclHintUser` to the enum, and the enum leaves the output.
 *
 * `installBefore` is given after `genes.Generator.use()`, and its callback
 * runs before the after-typing passes of Genes. `installAfter` is given
 * before it, and its callback runs after those passes. With the static
 * `excludeEarly`, `installBefore` excludes `ExclEarly`; with
 * `excludeLate`, `installAfter` excludes `ExclLate`.
 */
class ExcludeMacro {
  /** Excludes `ExclEarly` before the after-typing passes of Genes. */
  public static function installBefore(): Void {
    Context.onAfterTyping(types -> apply(types, 'excludeEarly', 'ExclEarly'));
  }

  /** Excludes `ExclLate` after the after-typing passes of Genes. */
  public static function installAfter(): Void {
    Context.onAfterTyping(types -> apply(types, 'excludeLate', 'ExclLate'));
  }

  static function apply(types: Array<ModuleType>, flag: String,
      name: String): Void {
    var asked = false;
    var target: Null<EnumType> = null;
    for (type in types)
      switch type {
        case TClassDecl(ref):
          final cls = ref.get();
          if (cls.module == 'inc.Leaf2' && cls.name == 'Leaf2')
            for (field in cls.statics.get())
              if (field.name == flag)
                asked = true;
        case TEnumDecl(ref):
          final enm = ref.get();
          if (enm.module == 'inc.ExclOwner' && enm.name == name)
            target = enm;
        default:
      }
    if (!asked)
      return;
    final found = target;
    if (found == null)
      Context.fatalError('ExcludeMacro: no enum ' + name, Context.currentPos());
    found.exclude();
  }
}
#end
