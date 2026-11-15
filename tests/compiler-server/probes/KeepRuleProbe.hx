import genes.incremental.GenerationChangeSet;
import genes.incremental.GenerationChangeSet.DeclarationArrival;
import genes.incremental.GenerationChangeSet.KeepDecision;
import genes.incremental.GenerationChangeSet.StampedDeclaration;
import haxe.macro.Context;

/**
 * Checks each condition of the keep rule on its own, with made-up inputs.
 *
 * Why: in a real request two conditions often reject the same record. A
 * declaration that Haxe typed again arrives without a stamp (condition 3),
 * and its new stamp also differs from the stamp in the record (condition 4).
 * A request sequence therefore cannot show that condition 4 works when
 * condition 3 is silent: every input that gives a kept declaration another
 * stamp than its record also changes the session key, which drops the record
 * first. This probe calls `GenerationChangeSet.keep` directly, so that each
 * case differs from the kept case in exactly one input.
 *
 * What: `check()` is an init macro. It reports a fatal error for the first
 * case with a wrong answer. When all cases pass it prints one line,
 * `keep-rule-probe:ok (<n> cases)`, which the gate
 * `yarn test:compiler-server:after-typing` requires.
 *
 * It keeps nothing and reads no declaration: the rule is a function of plain
 * text.
 */
class KeepRuleProbe {
  static inline final STAMP = 'ab12:3';
  static inline final MEMBERS = 'S:make,plain|I:|C:0|N:0';

  static var cases = 0;

  public static function check(): Void {
    // The kept case: one stamp that names the declaration, equal to the
    // record, and the same member list.
    expect('everything equal', Keep,
      GenerationChangeSet.keep(declaration(Kept, STAMP), STAMP, MEMBERS,
        () -> MEMBERS));
    expect('no record', Reject(NoRecord),
      GenerationChangeSet.keep(declaration(Kept, STAMP), null, null,
        () -> MEMBERS));
    // Condition 3 alone: the record and the member list agree with the
    // declaration, but the declaration arrived without a stamp.
    expect('typed again, all else equal', Reject(TypedAgain),
      GenerationChangeSet.keep(declaration(TypedAgain, STAMP), STAMP, MEMBERS,
        () -> MEMBERS));
    expect('stamp of another declaration, all else equal',
      Reject(StampNamesOtherDeclaration),
      GenerationChangeSet.keep(declaration(ForeignStamp, STAMP), STAMP,
        MEMBERS, () -> MEMBERS));
    // Condition 4 alone: the declaration is kept and names itself, but the
    // record was written for another stamp.
    expect('other stamp in the record, all else equal', Reject(StampDiffers),
      GenerationChangeSet.keep(declaration(Kept, STAMP), 'ab12:2', MEMBERS,
        () -> MEMBERS));
    expect('stamp of another interpreter in the record', Reject(StampDiffers),
      GenerationChangeSet.keep(declaration(Kept, STAMP), 'cd34:3', MEMBERS,
        () -> MEMBERS));
    // Condition 6 alone: only the member list differs.
    expect('other member list, all else equal', Reject(MembersChanged),
      GenerationChangeSet.keep(declaration(Kept, STAMP), STAMP, MEMBERS,
        () -> 'S:make_Int,make,plain|I:|C:0|N:0'));
    // A declaration that is not a class has no member list on either side.
    expect('not a class', Keep,
      GenerationChangeSet.keep(declaration(Kept, STAMP), STAMP, null,
        () -> null));
    // The member list is read only when the stamps agree.
    var reads = 0;
    GenerationChangeSet.keep(declaration(Kept, STAMP), 'ab12:2', MEMBERS,
      () -> {
        reads++;
        MEMBERS;
      });
    if (reads != 0)
      Context.fatalError('KeepRuleProbe: the member list was read for a record '
        + 'with another stamp',
        Context.currentPos());
    cases++;
    Sys.println('keep-rule-probe:ok ($cases cases)');
  }

  static function declaration(arrival: DeclarationArrival,
      stamp: String): StampedDeclaration {
    return {
      key: 'class:app.Models.User',
      module: 'app.Models',
      stamp: stamp,
      arrival: arrival
    };
  }

  static function expect(name: String, wanted: KeepDecision,
      got: KeepDecision): Void {
    cases++;
    if (!Type.enumEq(wanted, got))
      Context.fatalError('KeepRuleProbe: case "$name" gives $got, not $wanted',
        Context.currentPos());
  }
}
