import haxe.macro.Context;
import haxe.macro.Type;

/**
 * Reports which Haxe modules the compiler typed again in this request.
 *
 * Why: a compilation server keeps typed modules between requests. After a
 * one-file edit it should type only the modules that the edit can affect.
 * Haxe does not print that list, so the compiler-server test needs a way to
 * see it.
 *
 * How: at the end of each request the probe marks every declaration with
 * private metadata. A declaration that Haxe kept from the earlier request
 * still carries the mark. A declaration that Haxe typed again is a new object
 * and arrives without it. The probe writes the sorted module names of the
 * unmarked declarations to `report`, one name on each line.
 *
 * Limit: the first request of a server types everything, so its report lists
 * every module. Only later requests say something about an edit.
 */
class RetypedModulesProbe {
  static inline final MARK = ':genes.test.typedBefore';

  public static function install(report: String): Void {
    Context.onGenerate(types -> {
      final retyped = new Map<String, Bool>();
      final pos = Context.currentPos();
      for (type in types) {
        final base: Null<BaseType> = switch type {
          case TInst(ref, _): ref.get();
          case TEnum(ref, _): ref.get();
          case TType(ref, _): ref.get();
          case TAbstract(ref, _): ref.get();
          default: null;
        }
        if (base == null || base.meta.has(MARK))
          continue;
        retyped.set(base.module, true);
        base.meta.add(MARK, [], pos);
      }
      final names = [for (name in retyped.keys()) name];
      names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
      sys.io.File.saveContent(report, names.join('\n'));
    });
  }
}
