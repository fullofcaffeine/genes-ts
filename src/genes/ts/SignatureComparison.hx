package genes.ts;

#if macro
import genes.incremental.KeptRecords;
import genes.ts.SignatureCache.CachedSig;
import genes.ts.SignatureFacts.SignatureFact;
import haxe.macro.Type;

using haxe.macro.TypeTools;

/**
 * The compare mode of `SignatureCache`: for each question that the
 * generator asks, it compares the answer of the kept buckets with the answer
 * of a new capture of this request, and counts each difference.
 *
 * Why: with `-D genes.dev_incremental` and `afterTyping: "reuse"`,
 * `SignatureCache` answers from buckets that it made in earlier requests. A
 * wrong keep rule would give stale TypeScript. The compare mode
 * (`afterTyping: "compare"`) finds such a bucket without any risk for the
 * output: the request captures every declaration again and the generator
 * gets those new answers, as with reuse off.
 *
 * What: `kept` is the set of maps that a request with reuse on would have:
 * the facts of each kept bucket, and the new facts of each declaration
 * without a kept bucket, in declaration order. Each getter of
 * `SignatureCache` gives both answers to one of the functions here. A
 * question is compared once for each key. Two `Type` values are equal when
 * Haxe prints the same text for them at the time of the question.
 *
 * A difference is a failure (a defect of the keep rule), with one exception
 * that has a known cause and is counted as explained: a fact about a local
 * variable, when the kept bucket of the declaration that owns the variable
 * was made in the request in which Haxe typed that declaration. Haxe
 * changes each typed body after the after-typing callbacks (it lowers
 * loops, removes inlined objects, adds temporary variables) and saves the
 * changed state. The kept bucket holds the read before that change, which is
 * also what a build in a new compiler process reads. The new capture of a
 * later request reads the changed body. Example: an inlined call leaves a
 * new local `_g: Phase`; the new capture has a fact for it, the kept bucket
 * and a build in a new process have none.
 *
 * It keeps no value after the request: `SignatureCache.install()` drops it.
 */
class SignatureComparison {
  /** The maps that a request with reuse on would answer from. */
  public final kept = new SignatureFacts();

  final counts: KeptRecords;
  final keptLocalOwners: Map<Int, String> = new Map();
  final newLocalOwners: Map<Int, String> = new Map();
  final earlierFirstReads: Map<String, Bool> = new Map();
  final compared: Map<String, Bool> = new Map();

  /** `counts` receives the number of compared questions and each difference. */
  public function new(counts: KeptRecords) {
    this.counts = counts;
  }

  /**
   * Puts the facts of the bucket of declaration `owner` into `kept`.
   * `earlierFirstRead` is true when the bucket was made in an earlier
   * request, in which Haxe typed the declaration.
   */
  public function replay(owner: String, bucket: Array<SignatureFact>,
      earlierFirstRead: Bool): Void {
    if (earlierFirstRead)
      earlierFirstReads.set(owner, true);
    for (fact in bucket) {
      kept.put(fact);
      switch fact {
        case LocalSourceType(id, _) | DirectEnumLocalSourceType(id, _):
          keptLocalOwners.set(id, owner);
        default:
      }
    }
  }

  /** Notes which declaration owns the local variable of a new fact. */
  public function noteNew(owner: String, fact: SignatureFact): Void {
    switch fact {
      case LocalSourceType(id, _) | DirectEnumLocalSourceType(id, _):
        newLocalOwners.set(id, owner);
      default:
    }
  }

  /** Compares two text answers, for example a literal spelling. */
  public function texts(query: String, key: String, keptAnswer: Null<String>,
      newAnswer: Null<String>): Void {
    if (first(query, key) && keptAnswer != newAnswer)
      counts.countCompareFailure(difference(query, key, textOf(keptAnswer),
        textOf(newAnswer)));
  }

  /** Compares two type answers by the text that Haxe prints for them. */
  public function types(query: String, key: String, keptAnswer: Null<Type>,
      newAnswer: Null<Type>): Void {
    if (!first(query, key))
      return;
    final keptText = typeText(keptAnswer);
    final newText = typeText(newAnswer);
    if (keptText != newText)
      counts.countCompareFailure(difference(query, key, keptText, newText));
  }

  /** Compares two signature answers: each flag, spelling and type. */
  public function sigs(key: String, keptAnswer: Null<CachedSig>,
      newAnswer: Null<CachedSig>): Void {
    if (!first('sig', key))
      return;
    final keptText = sigText(keptAnswer);
    final newText = sigText(newAnswer);
    if (keptText != newText)
      counts.countCompareFailure(difference('sig', key, keptText, newText));
  }

  /**
   * Compares two answers about the local variable `id`. A difference is
   * explained when the kept bucket of the owner is the read of an earlier
   * request that typed the owner (see the class comment); else it is a
   * failure.
   */
  public function locals(query: String, id: Int, keptAnswer: Null<Type>,
      newAnswer: Null<Type>): Void {
    if (!first(query, Std.string(id)))
      return;
    final keptText = typeText(keptAnswer);
    final newText = typeText(newAnswer);
    if (keptText == newText)
      return;
    final owner = keptLocalOwners.get(id) ?? newLocalOwners.get(id);
    final text = difference(query,
      '$id of ${owner == null ? 'an unknown declaration' : owner}', keptText,
      newText);
    if (owner != null && earlierFirstReads.exists(owner))
      counts.countCompareExplained(text);
    else
      counts.countCompareFailure(text);
  }

  /** Returns true the first time that this question is asked in the request. */
  function first(query: String, key: String): Bool {
    final id = query + ' ' + key;
    if (compared.exists(id))
      return false;
    compared.set(id, true);
    counts.countCompareQuery();
    return true;
  }

  static function difference(query: String, key: String, keptText: String,
      newText: String): String {
    return '$query $key: kept $keptText; new capture $newText';
  }

  static function textOf(value: Null<String>): String {
    return value == null ? 'none' : value;
  }

  static function typeText(type: Null<Type>): String {
    return type == null ? 'none' : type.toString();
  }

  static function sigText(sig: Null<CachedSig>): String {
    if (sig == null)
      return 'none';
    final args = [
      for (arg in sig.args)
        (arg.opt ? '?' : '')
        + (arg.allowsNull ? 'N' : '')
        + (arg.preservesUndefined ? 'U' : '')
        + ' '
        + textOf(arg.tsType)
        + ' '
        + typeText(arg.sourceType)];
    return '('
      + args.join(', ')
      + ') -> '
      + textOf(sig.retTsType)
      + ' '
      + typeText(sig.retSourceType);
  }
}
#end
