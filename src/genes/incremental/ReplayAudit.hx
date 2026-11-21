package genes.incremental;

#if macro
/**
 * Chooses which replayed modules a `"generation": "reuse"` request prints
 * again for the rolling replay audit (Stage 3, genes-f8vc.9.23), and
 * remembers when each module was last printed again.
 *
 * Why: the clean rules decide from recorded facts whether stored output is
 * still right. Reviews found holes in such rules more than once (import-cycle
 * answers and position-keyed `SignatureCache` facts in #244; metadata that
 * only a typed body holds, limit L3). A hole publishes stale TypeScript, and
 * the stale entry stays in the cache until Haxe types its module again. The
 * audit is the runtime net under the rules: after publication, Genes prints a
 * few replayed modules again into memory and compares the bytes
 * (`IncrementalShadow.auditModule`). A difference drops the cache, so the
 * next request generates in full.
 *
 * What: `choose` is the pure rule; `select` applies it to this request with
 * the remembered ages. The module that waited longest since its last audit
 * goes first; a module that was never audited counts as the longest wait.
 * Modules that waited equally long are ordered by a digest of the seed and
 * the module name, then by the name. Over requests that replay the same set
 * of `R` modules with `k` audits each, every module is printed again within
 * `ceil(R / k)` requests.
 *
 * Example: replayed `[a, b, c]`, never audited, `k = 2`: the first request
 * audits the two whose seeded digests come first, say `b` and `c`; the next
 * request audits `a` (never audited) and then the older of `b` and `c`.
 *
 * Lifetime: the ages are `@:persistent` plain data (module name to request
 * number) for one compiler server. They stay when the generation cache is
 * dropped after an audit difference: the rotation then goes on where it was,
 * instead of starting again at the same first modules after every drop.
 * Nothing here holds a typed compiler value.
 */
class ReplayAudit {
  /** Replayed modules that a request prints again when the descriptor names no count. */
  public static inline final DEFAULT_MODULES = 2;

  /** The request number in which each module was last printed again. */
  @:persistent static var lastAudited: Map<String, Int> = new Map();

  /**
   * Returns the modules of `replayed` that the audit prints again, at most
   * `count`, in the order of the rule above. `lastAudit` gives the request
   * number of a module's last audit, or `null` when it was never audited.
   * The result does not depend on the order of `replayed`.
   *
   * Example: `choose(["a", "b"], m -> m == "a" ? 3 : null, 1, 0)` gives
   * `["b"]`: `b` was never audited.
   */
  public static function choose(replayed: Array<String>,
      lastAudit: String->Null<Int>, count: Int, seed: Int): Array<String> {
    if (count <= 0)
      return [];
    final ranked = [
      for (module in replayed)
        {
          module: module,
          last: {
            final known = lastAudit(module);
            known == null ? -1 : known;
          },
          digest: haxe.crypto.Sha1.encode('$seed:$module')
        }
    ];
    ranked.sort(compareRanks);
    return [
      for (index in 0...Std.int(Math.min(count, ranked.length)))
        ranked[index].module
    ];
  }

  /**
   * Orders two ranked modules for `choose`: the older last audit first, then
   * the smaller seeded digest, then the smaller name.
   */
  static function compareRanks(left: {last: Int, digest: String, module: String},
      right: {last: Int, digest: String, module: String}): Int {
    if (left.last != right.last)
      return left.last < right.last ? -1 : 1;
    if (left.digest != right.digest)
      return left.digest < right.digest ? -1 : 1;
    if (left.module != right.module)
      return left.module < right.module ? -1 : 1;
    return 0;
  }

  /**
   * Chooses the modules to audit in request `request` (`choose` with the
   * remembered ages) and records `request` as their last audit.
   */
  public static function select(replayed: Array<String>, request: Int,
      count: Int, seed: Int): Array<String> {
    final chosen = choose(replayed, module -> lastAudited.get(module), count,
      seed);
    for (module in chosen)
      lastAudited.set(module, request);
    return chosen;
  }

  /**
   * Forgets every remembered audit, so that every module counts as never
   * audited again. Genes itself never calls it: a dropped cache keeps the
   * ages (see the class comment). `tests.replayaudit.ReplayAuditProbe` calls
   * it to start each case from a known state.
   */
  public static function forget(): Void {
    lastAudited = new Map();
  }
}
#end
