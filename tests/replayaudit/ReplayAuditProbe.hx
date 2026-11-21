package tests.replayaudit;

#if macro
import genes.incremental.IncrementalRequest;
import genes.incremental.ReplayAudit;
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Compile-time checks of the rules that choose the modules of the rolling
 * replay audit (`genes.incremental.ReplayAudit`, genes-f8vc.9.23) and of the
 * descriptor field that sets it (`audit` in
 * `genes.incremental.IncrementalRequest`).
 *
 * Why at macro time: the audit exists only in the macro interpreter of a
 * compiler server. A request sequence on a fixture shows only the order that
 * its modules happen to give; these cases name the order with made-up
 * module names, so a change of the rule fails here first.
 *
 * Cases: a module that was never audited comes first; then the module that
 * waited longest; equally due modules follow a seeded order that does not
 * depend on the input order and changes with the seed; the count limits the
 * result and 0 gives none; `select` audits every module of a stable set
 * within `ceil(R / k)` requests and `forget` starts again. The descriptor:
 * an absent `audit` gives two modules and seed 0, a given object is read,
 * and a wrong value turns the request off with a reason.
 *
 * `test.hxml` runs this probe, so `yarn test` fails when a case fails. It
 * changes the remembered ages of its own compiler process only.
 */
class ReplayAuditProbe {
  public static macro function validate(): Expr {
    #if macro
    final never: String->Null<Int> = _ -> null;
    final ages = ['a' => 5, 'b' => 2, 'c' => 9];
    final aged: String->Null<Int> = module -> ages.get(module);

    require(ReplayAudit.choose(['a', 'b', 'c', 'd'], aged, 1, 0)
      .join(',') == 'd',
      'a module that was never audited must come first');
    require(ReplayAudit.choose(['a', 'b', 'c'], aged, 3, 0)
      .join(',') == 'b,a,c',
      'modules must follow the request of their last audit, oldest first');
    require(ReplayAudit.choose(['a', 'b', 'c'], aged, 0, 0).length == 0,
      'a count of 0 must audit nothing');
    require(ReplayAudit.choose(['a', 'b'], aged, 5, 0).length == 2,
      'the count may be larger than the replayed modules');

    final names = [for (index in 0...12) 'm$index'];
    final reversed = names.copy();
    reversed.reverse();
    final seeded = ReplayAudit.choose(names, never, names.length, 7);
    require(ReplayAudit.choose(reversed, never, names.length, 7)
      .join(',') == seeded.join(','),
      'equally due modules must not depend on the input order');
    require(ReplayAudit.choose(names, never, names.length, 7)
      .join(',') == seeded.join(','),
      'the same seed must give the same order');
    require(ReplayAudit.choose(names, never, names.length, 8)
      .join(',') != seeded.join(','),
      'another seed must give another order of equally due modules');
    final byName = (left: String,
      right: String) -> left < right ? -1 : left > right ? 1 : 0;
    final sorted = seeded.copy();
    sorted.sort(byName);
    final expected = names.copy();
    expected.sort(byName);
    require(sorted.join(',') == expected.join(','),
      'the order must hold every module once');

    ReplayAudit.forget();
    final seen = new Map<String, Bool>();
    final set = ['p', 'q', 'r', 's', 't'];
    for (request in 1...4)
      for (module in ReplayAudit.select(set, request, 2, 0))
        seen.set(module, true);
    require([for (module in set) if (!seen.exists(module)) module].length == 0,
      'select must audit each of 5 modules within ceil(5 / 2) = 3 requests');
    // Seeded order o0..o4: request 1 audits o0 and o1, request 2 o2 and o3,
    // request 3 o4 and then o0 (o0 and o1 waited equally long since request
    // 1; the seed puts o0 first). Request 4 audits o1, the oldest.
    final order = ReplayAudit.choose(set, never, set.length, 0);
    final next = ReplayAudit.select(set, 4, 1, 0);
    require(next.length == 1 && next[0] == order[1],
      'request 4 must audit the module that waited since request 1');
    ReplayAudit.forget();
    require(ReplayAudit.select(['p', 'z'], 5, 1,
      0)[0] == ReplayAudit.choose(['p', 'z'], never, 1, 0)[0],
      'forget must clear every remembered audit');
    ReplayAudit.forget();

    final base = '{"format": 1, "programDigest": "d", "kind": "full", '
      + '"afterTyping": "reuse", "generation": "reuse"';
    switch IncrementalRequest.decodeDescriptor('/d', base + '}') {
      case Right(descriptor):
        final audit = IncrementalRequest.auditSettings(descriptor);
        require(audit.modules == ReplayAudit.DEFAULT_MODULES && audit.seed == 0,
          'an absent audit field must give the default settings');
      case Left(reason):
        require(false, 'a descriptor without audit was refused: $reason');
    }
    switch IncrementalRequest.decodeDescriptor('/d',
      base + ', "audit": {"modules": 0, "seed": 3}}') {
      case Right(descriptor):
        final audit = IncrementalRequest.auditSettings(descriptor);
        require(audit.modules == 0 && audit.seed == 3,
          'the audit object must be read');
      case Left(reason):
        require(false, 'a valid audit field was refused: $reason');
    }
    for (wrong in [
                     '"audit": 2', '"audit": {"modules": -1}',
      '"audit": {"modules": 1.5}',   '"audit": {"seed": "x"}'
    ])
      switch IncrementalRequest.decodeDescriptor('/d', base + ', $wrong}') {
        case Right(_):
          require(false, 'a wrong audit field was accepted: $wrong');
        case Left(_):
      }
    #end
    return macro null;
  }

  #if macro
  static function require(condition: Bool, message: String): Void {
    if (!condition)
      Context.fatalError('ReplayAudit probe failed: $message',
        Context.currentPos());
  }
  #end
}
