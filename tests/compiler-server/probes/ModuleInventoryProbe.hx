import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Writes what `genes.TypedModuleInventory` answers for one module, beside
 * what Haxe itself answers.
 *
 * Why: the inventory replaces `Context.getModule` during generation, so its
 * list must be the same list: each declaration once, in Haxe's order. A
 * mistake such as collecting every declaration twice does not change the
 * generated files, because callers stop at the first match. Only a direct
 * comparison shows it.
 *
 * How: when typing has finished, the probe writes two lines to `report`:
 * the inventory's declaration names, then the names from
 * `Context.getModule`. The compiler-server test requires equal lines.
 */
class ModuleInventoryProbe {
  public static function install(module: String, report: String): Void {
    Context.onGenerate(_ -> {
      sys.io.File.saveContent(report,
        names(genes.TypedModuleInventory.moduleTypes(module)) + '\n' +
        names(Context.getModule(module)));
    });
  }

  static function names(types: Array<Type>): String {
    return [
      for (type in types)
        switch type {
          case TInst(ref, _):
            ref.toString();
          case TEnum(ref, _):
            ref.toString();
          case TType(ref, _):
            ref.toString();
          case TAbstract(ref, _):
            ref.toString();
          default:
            '?';
        }
    ].join(',');
  }
}
