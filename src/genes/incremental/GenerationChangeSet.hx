package genes.incremental;

#if macro
import haxe.crypto.Sha256;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
import genes.DependencyPlan;

/**
 * Says which Haxe modules the compiler typed again in this request, and when
 * each declaration was first seen.
 *
 * Why: Haxe gives the generator no list of changed modules. But metadata that
 * a macro adds to a declaration stays on it while Haxe keeps the declaration
 * in its cache, and a declaration that Haxe typed again is a new object
 * without it. Each declaration therefore gets one stamp,
 * `@:genes.typedEpoch(nonce, N)`, the first time Genes sees it.
 *
 * What, for one request (interface I2 of the Stage 3 review):
 *
 * - `epochs(module)`: the sorted `declaration key@nonce:N` list of the
 *   module. Two equal lists mean that Haxe did not type the module again and
 *   that no declaration was added or removed.
 * - `retypedModules()`: modules with at least one declaration that got its
 *   stamp in this request.
 * - `reservedNameDigest()`: digest of the names that Haxe's local-rename
 *   filter reserves (`renameVars.ml`, `reserve_all_types`). The review
 *   expected that a new top-level name renames locals of every module in a
 *   cold build while cached modules keep their old names. The fixture showed
 *   no such difference, so the digest is reported only and triggers no
 *   restart (see `GenerationCache.RestartRequired`).
 *
 * How: `observe` runs inside the `onAfterTyping` callback of
 * `TypedModuleInventory`, which already receives every declaration. That is
 * before dead-code elimination and before Haxe saves the class state that a
 * cached class returns to, so the stamp survives in the cache. `nonce` is a
 * `@:persistent` random value for one life of the macro interpreter: a new
 * interpreter counts requests from 1 again, so the nonce keeps two stamps
 * from being equal. A stamp of an earlier interpreter is kept as it is (see
 * `stamp`). A cached class that was typed while no stamp was added (a request
 * without the define, or an `@:rtti` program) stays unstamped in Haxe's saved
 * state, so it counts as typed again on each request until Haxe types it
 * again. That is slow, not wrong.
 *
 * Order: Haxe 4.3.7 runs `onAfterTyping` callbacks in reverse order of
 * registration. `Generator.use()` installs the inventory before the passes of
 * `AfterTypingPasses` and `ModuleDirectivePlan`, so those passes run before
 * this change set is filled. Slice 1 reads it only in the generator. A later
 * change that lets the passes skip unchanged modules must first make the
 * change set readable before they run.
 *
 * `@:rtti`: Haxe prints the metadata of an `@:rtti` class into its `__rtti`
 * string after this callback. A stamp would then reach output, so a program
 * with such a class gets no stamp and the incremental path is off.
 *
 * Lifetime: the maps belong to one request; `reset()` replaces them at the
 * first `Generator.use()`. Only the nonce and the request counter outlive the
 * request. Without `-D genes.dev_incremental` nothing here runs.
 */
class GenerationChangeSet {
  /** The metadata name of the epoch stamp. */
  public static inline final EPOCH_META = ':genes.typedEpoch';

  @:persistent static var nonce: Null<String> = null;
  @:persistent static var requestCounter = 0;
  @:persistent static var requestNumber = 0;
  @:persistent static var moduleEpochs: Map<String, Array<String>> = new Map();
  @:persistent static var retyped: Map<String, Bool> = new Map();
  @:persistent static var reservedNames: Map<String, Bool> = new Map();
  @:persistent static var digest: Null<String> = null;
  @:persistent static var observeSeconds = 0.0;

  /** Starts an empty change set for the current request. */
  public static function reset(): Void {
    requestNumber = 0;
    moduleEpochs = new Map();
    retyped = new Map();
    reservedNames = new Map();
    digest = null;
    observeSeconds = 0.0;
  }

  /**
   * Stamps and records one array that Haxe gave to `onAfterTyping`.
   *
   * Haxe may call the callback again in one request, when a callback defines
   * new types; those declarations are new, so they count as typed again.
   */
  public static function observe(types: Array<ModuleType>): Void {
    if (!IncrementalRequest.shadowActive())
      return;
    final started = haxe.Timer.stamp();
    for (type in types) {
      if (isRtti(type)) {
        IncrementalRequest.turnOff('the program has an @:rtti class: Haxe '
          +
          'prints its metadata into __rtti, so an epoch stamp would reach output');
        observeSeconds += haxe.Timer.stamp() - started;
        return;
      }
    }
    if (requestNumber == 0) {
      requestCounter++;
      requestNumber = requestCounter;
    }
    final currentNonce = interpreterNonce();
    final pos = Context.currentPos();
    for (type in types) {
      final base = DependencyPlan.moduleTypeBase(type);
      final kept = stamp(base, currentNonce, pos);
      final key = DependencyPlan.moduleTypeKey(type);
      final list = moduleEpochs.get(base.module);
      final entry = '$key@'
        + (kept != null ? kept : '$currentNonce:$requestNumber');
      if (list == null)
        moduleEpochs.set(base.module, [entry]);
      else
        list.push(entry);
      if (kept == null)
        retyped.set(base.module, true);
      reserveNames(type, base);
    }
    digest = null;
    observeSeconds += haxe.Timer.stamp() - started;
  }

  /** Returns the request number that this request stamps with, or 0 before typing. */
  public static function request(): Int {
    return requestNumber;
  }

  /** Returns the epoch list of one module as one string; empty when Haxe gave no declaration. */
  public static function epochs(module: String): String {
    final list = moduleEpochs.get(module);
    if (list == null)
      return '';
    final sorted = list.copy();
    sorted.sort(compareStrings);
    return sorted.join('\n');
  }

  /** Returns the sorted modules that Haxe typed again in this request. */
  public static function retypedModules(): Array<String> {
    final names = [for (name in retyped.keys()) name];
    names.sort(compareStrings);
    return names;
  }

  /** Returns the digest of the names that Haxe's rename filter reserves. */
  public static function reservedNameDigest(): String {
    final known = digest;
    if (known != null)
      return known;
    final names = [for (name in reservedNames.keys()) name];
    names.sort(compareStrings);
    final computed = Sha256.encode(names.join('\n'));
    digest = computed;
    return computed;
  }

  /** Returns the seconds spent in `observe` in this request. */
  public static function overheadSeconds(): Float {
    return observeSeconds;
  }

  /**
   * Returns the identity `nonce:N` of the stamp that `base` already carries,
   * or adds a stamp of this request and returns `null`.
   *
   * A stamp of an earlier macro interpreter is kept and still names the same
   * typed declaration: the pair (nonce, N) was unique when it was issued, and
   * a declaration that Haxe types again arrives without any stamp. Replacing
   * such a stamp would not last: Haxe restores the metadata of a cached class
   * to the state it saved when it typed the class, so the class would look
   * typed again on every request after an interpreter reset. A malformed
   * entry is replaced.
   */
  static function stamp(base: BaseType, currentNonce: String,
      pos: Position): Null<String> {
    var malformed = false;
    for (entry in base.meta.extract(EPOCH_META)) {
      switch entry.params {
        case [{expr: EConst(CString(stampNonce,
          _))}, {expr: EConst(CInt(value))}]:
          return '$stampNonce:$value';
        default:
          malformed = true;
      }
    }
    if (malformed)
      base.meta.remove(EPOCH_META);
    base.meta.add(EPOCH_META, [
      {expr: EConst(CString(currentNonce, DoubleQuotes)), pos: pos},
      {expr: EConst(CInt(Std.string(requestNumber))), pos: pos}
    ], pos);
    return null;
  }

  /**
   * Adds the names that `renameVars.ml` (`reserve_all_types`) reserves for one
   * declaration: its native name, or the first package name, or the type name
   * when there is no package. A class with an empty native name reserves its
   * statics, and a module-fields class reserves its flat field names.
   */
  static function reserveNames(type: ModuleType, base: BaseType): Void {
    final native = nativeName(base.meta);
    final topLevel = base.pack.length > 0 ? base.pack[0] : base.name;
    switch type {
      case TClassDecl(ref) if (native == ''):
        for (field in ref.get().statics.get()) {
          final fieldNative = nativeName(field.meta);
          reservedNames.set(fieldNative != null ? fieldNative : field.name,
            true);
        }
      case TClassDecl(ref):
        switch ref.get().kind {
          case KModuleFields(module):
            final prefix = module.split('.').join('_') + '_';
            for (field in ref.get().statics.get()) {
              final fieldNative = nativeName(field.meta);
              reservedNames.set(fieldNative != null ? fieldNative : prefix
                + field.name, true);
            }
          default:
            reservedNames.set(native != null ? native : topLevel, true);
        }
      default:
        reservedNames.set(native != null ? native : topLevel, true);
    }
  }

  static function nativeName(meta: MetaAccess): Null<String> {
    for (entry in meta.extract(':native')) {
      switch entry.params {
        case [{expr: EConst(CString(value, _))}]:
          return value;
        default:
      }
    }
    return null;
  }

  static function isRtti(type: ModuleType): Bool {
    return switch type {
      case TClassDecl(ref): ref.get().meta.has(':rtti');
      default: false;
    }
  }

  static function interpreterNonce(): String {
    final known = nonce;
    if (known != null)
      return known;
    final created = Sha256.encode(Std.string(Sys.time())
      + ':'
      + Std.string(Std.random(0x3FFFFFFF))
      + ':'
      + Std.string(Std.random(0x3FFFFFFF)))
      .substr(0, 16);
    nonce = created;
    return created;
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}
#end
