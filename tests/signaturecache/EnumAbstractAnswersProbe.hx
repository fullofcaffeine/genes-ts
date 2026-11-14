package tests.signaturecache;

#if macro
import genes.ts.SignatureCache;
import haxe.macro.Context;
import haxe.macro.Type;
#end

/**
 * Checks that `genes.ts.SignatureCache` gives the same "contains an enum
 * abstract" answer when it reuses what it learned about a declaration.
 *
 * Why at macro time: the answer is a compiler-owned `Type` that the cache
 * keeps or drops. Generated code shows it only indirectly, and only for some
 * shapes. This probe reads the kept types directly.
 *
 * What it checks: `SignatureCache` asks, for each field of
 * `EnumAbstractAnswers`, whether the field type contains an enum abstract.
 * Since it remembers the answer for a declaration during one request, three
 * shortcuts would be wrong, and each has one field that catches it:
 *
 * - `cycleEarly` and `cycleLate`: while the walk of `CycleA` is active, a
 *   neighbour looks empty, because its only field points back to `CycleA`.
 *   That "no" must not be remembered: both neighbours do reach `AnswerPhase`.
 * - `phaseBox`: `AnswerBox<String>` answered "no" for the body of `AnswerBox`.
 *   The type argument of a later use must still be checked.
 * - `plainSameEarly` and `plainSameLate`: inside `AnswerLoop`, the walk of an
 *   alias applied to `AnswerLoop` finds the phase, but only through that one
 *   type argument. That "yes" must not be remembered for the same alias
 *   applied to `String`.
 */
class EnumAbstractAnswersProbe {
  #if macro
  /** Installs the check. `test.hxml` calls it with `--macro`. */
  public static function install(): Void {
    // `-D genes.disable` runs the standard Haxe generator without the cache.
    if (Context.defined('genes.disable'))
      return;
    Context.onGenerate(types -> {
      for (type in types) {
        switch type {
          case TInst(_.get() => cl, _)
            if (cl.module == 'tests.signaturecache.EnumAbstractAnswers'
              && cl.name == 'EnumAbstractAnswers'):
            check(cl);
            return;
          default:
        }
      }
      Context.error('tests.signaturecache.EnumAbstractAnswers was not typed',
        Context.currentPos());
    });
  }

  static function check(cl: ClassType): Void {
    final expected = [
      'cycleFirst' => true,
      'cycleEarly' => true,
      'cycleLate' => true,
      'plainBox' => false,
      'phaseBox' => true,
      'loop' => true,
      'plainSameEarly' => false,
      'plainSameLate' => false,
      'plainText' => false
    ];
    for (field => containsEnumAbstract in expected) {
      final kept = SignatureCache.getFieldSourceType(cl, false, field) != null;
      if (kept != containsEnumAbstract)
        Context.error('SignatureCache answered $kept for EnumAbstractAnswers.$field; expected $containsEnumAbstract',
          cl.pos);
    }
  }
  #end
}
