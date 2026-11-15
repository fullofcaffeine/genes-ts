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
 *
 * It also checks the literal spelling (`"low" | "high"`) that the cache keeps
 * beside an answer; see `checkLiteralSpellings`.
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
    checkLiteralSpellings(cl);
  }

  /**
   * Checks that the capture keeps the same literal spelling as the direct
   * question `enumAbstractLiteralUnionTsType`.
   *
   * Why: the capture asks that question only when its walk found an enum
   * abstract in the type. The walk stops after 64 levels and then answers
   * "no" for a type that does have a spelling. The capture must notice the
   * stop and ask the direct question.
   *
   * What it checks: `AnswerLevel` alone, and below 1, 64 and 65 levels of
   * `Null`. The walk reaches the level through 64 `Null` and stops at 65.
   * Haxe source cannot name the deep types through a typedef, because the
   * walk follows a typedef and its `Null` in one step. So the probe builds
   * them from the `Null<AnswerLevel>` type of `nullableLevel`. A record and
   * `String` have no spelling before or after.
   */
  @:access(genes.ts.SignatureCache)
  static function checkLiteralSpellings(cl: ClassType): Void {
    var checkedLevels = false;
    for (field in cl.fields.get()) {
      switch [field.name, field.type] {
        case ['nullableLevel', TAbstract(nullReference, [level])]:
          checkedLevels = true;
          function below(levels: Int): Type {
            var type = level;
            for (_ in 0...levels)
              type = TAbstract(nullReference, [type]);
            return type;
          }
          expectSameSpelling(cl, 'AnswerLevel', level, true);
          expectSameSpelling(cl, 'AnswerLevel below 1 Null', below(1), true);
          expectSameSpelling(cl, 'AnswerLevel below 64 Null', below(64), true);
          expectSameSpelling(cl, 'AnswerLevel below 65 Null', below(65), true);
          if (SignatureCache.sourceTypeWithEnumAbstract(below(64)) == null
            || SignatureCache.sourceTypeWithEnumAbstract(below(65)) != null)
            Context.error('The walk limit moved: the probe needs one type that the walk reaches and one that it does not',
              cl.pos);
        case ['phaseBox' | 'plainText', type]:
          expectSameSpelling(cl, field.name, type, false);
        default:
      }
    }
    if (!checkedLevels)
      Context.error('EnumAbstractAnswers.nullableLevel is not Null<AnswerLevel>; the probe builds its deep types from it',
        cl.pos);
  }

  @:access(genes.ts.SignatureCache)
  static function expectSameSpelling(cl: ClassType, label: String, type: Type,
      hasSpelling: Bool): Void {
    final direct = SignatureCache.enumAbstractLiteralUnionTsType(type);
    final captured = SignatureCache.literalUnionAfterWalk(type,
      SignatureCache.sourceTypeWithEnumAbstract(type));
    if ((direct != null) != hasSpelling)
      Context.error('The direct question answered $direct for $label; the probe expects ${hasSpelling ? "a spelling" : "none"}',
        cl.pos);
    if (captured != direct)
      Context.error('SignatureCache kept the spelling $captured for $label; the direct question answers $direct',
        cl.pos);
  }
  #end
}
