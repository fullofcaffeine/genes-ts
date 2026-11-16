import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Counts the declarations that carry Genes' incremental epoch stamp.
 *
 * Why: without `-D genes.dev_incremental` the incremental path must be off
 * completely. Its stamp is metadata on a typed declaration, so it would not
 * always show in generated files. This probe looks at the declarations
 * directly.
 *
 * How: at `onGenerate`, the probe writes the number of declarations with a
 * `@:genes.typedEpoch` entry to `report`. The shadow test requires 0 for each
 * request without the define, and more than 0 with it.
 */
class EpochStampProbe {
  public static function install(report: String): Void {
    Context.onGenerate(types -> {
      var stamped = 0;
      for (type in types) {
        final base: Null<BaseType> = switch type {
          case TInst(ref, _): ref.get();
          case TEnum(ref, _): ref.get();
          case TType(ref, _): ref.get();
          case TAbstract(ref, _): ref.get();
          default: null;
        }
        if (base != null && base.meta.has(':genes.typedEpoch'))
          stamped++;
      }
      sys.io.File.saveContent(report, Std.string(stamped));
    });
  }
}
