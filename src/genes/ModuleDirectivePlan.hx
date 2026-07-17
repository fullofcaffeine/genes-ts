package genes;

import haxe.ds.ReadOnlyArray;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Expr.Position;
import haxe.macro.Type;

using StringTools;

/** One validated ECMAScript directive with its original source position. */
class ModuleDirective {
  public final value: String;
  public final pos: Position;

  public function new(value: String, pos: Position) {
    this.value = value;
    this.pos = pos;
  }
}

private typedef CapturedDirectiveOwner = {
  final key: String;
  final pos: Position;
  final directives: Array<ModuleDirective>;
}

/**
 * Captures target-neutral ECMAScript module directives before Haxe DCE.
 *
 * Why: a directive prologue is a property of an emitted module, not of one
 * runtime class. Haxe may remove the declaration carrying the metadata while
 * retaining another declaration from the same source module. Reading metadata
 * in either printer would therefore make the result depend on DCE and could
 * let TypeScript and classic JavaScript disagree.
 *
 * What: repeated `@:genes.moduleDirective("literal")` metadata on one
 * top-level declaration becomes an ordered, exact-deduplicated module plan.
 * Empty or computed values and multiple metadata owners in one Haxe module are
 * rejected with stable source-positioned diagnostics.
 *
 * How: `install()` records typed declarations in an `onAfterTyping` callback
 * without adding `@:keep`, roots, or dependency edges. `validate()` sorts by
 * source position and freezes plans before the output transaction opens any
 * emitter. A plan affects a module only when normal reachability independently
 * causes that module to be emitted; declaration files never consume it.
 */
class ModuleDirectivePlan {
  public static inline final METADATA = ':genes.moduleDirective';

  @:persistent static var ownersByModule: Map<String,
    Array<CapturedDirectiveOwner>> = new Map();
  @:persistent static var seenOwners: Map<String, Bool> = new Map();
  @:persistent static var plans: Map<String, ModuleDirectivePlan> = new Map();
  @:persistent static var finalized = false;

  static final EMPTY = new ModuleDirectivePlan([]);

  final directiveValues: Array<ModuleDirective>;

  public var directives(get, never): ReadOnlyArray<ModuleDirective>;

  function new(directives: Array<ModuleDirective>) {
    directiveValues = directives.copy();
  }

  function get_directives(): ReadOnlyArray<ModuleDirective> {
    return directiveValues;
  }

  /** Resets and installs the pre-DCE metadata capture for one compilation. */
  public static function install(): Void {
    ownersByModule = new Map();
    seenOwners = new Map();
    plans = new Map();
    finalized = false;
    Context.onAfterTyping(capture);
  }

  static function capture(types: Array<ModuleType>): Void {
    for (type in types) {
      final base = DependencyPlan.moduleTypeBase(type);
      final entries = base.meta.extract(METADATA);
      if (entries.length == 0)
        continue;

      final ownerKey = DependencyPlan.moduleTypeKey(type);
      if (seenOwners.exists(ownerKey))
        continue;
      seenOwners.set(ownerKey, true);

      entries.sort((left, right) -> comparePosition(left.pos, right.pos));
      final directives = [
        for (entry in entries)
          new ModuleDirective(literal(entry), entry.pos)
      ];
      final owner: CapturedDirectiveOwner = {
        key: ownerKey,
        pos: directives[0].pos,
        directives: directives
      };
      final owners = ownersByModule.get(base.module);
      if (owners == null)
        ownersByModule.set(base.module, [owner]);
      else
        owners.push(owner);
    }
  }

  static function literal(entry: haxe.macro.Expr.MetadataEntry): String {
    if (entry.params.length != 1) {
      return Context.error('GENES-MODULE-DIRECTIVE-ARITY-001: '
        + '@:genes.moduleDirective requires exactly one string literal',
        entry.pos);
    }
    final parameter = entry.params[0];
    return switch parameter.expr {
      case EConst(CString(value)):
        if (value.trim().length == 0) {
          Context.error('GENES-MODULE-DIRECTIVE-EMPTY-001: '
            + '@:genes.moduleDirective requires a non-empty string literal',
            parameter.pos);
        } else {
          value;
        }
      default:
        Context.error('GENES-MODULE-DIRECTIVE-LITERAL-001: '
          + '@:genes.moduleDirective does not accept computed values',
          parameter.pos);
    }
  }

  static function comparePosition(left: Position, right: Position): Int {
    final leftInfo = Context.getPosInfos(left);
    final rightInfo = Context.getPosInfos(right);
    final fileOrder = Reflect.compare(leftInfo.file, rightInfo.file);
    if (fileOrder != 0)
      return fileOrder;
    final startOrder = leftInfo.min - rightInfo.min;
    return startOrder != 0 ? startOrder : leftInfo.max - rightInfo.max;
  }

  /**
   * Validates cross-declaration ownership and freezes every captured plan.
   *
   * This runs at the start of generation, after all typing callbacks have
   * contributed facts but before any emitter writes staged output. Sorting the
   * owners makes the conflict position deterministic even if Haxe reports
   * typing batches in a different order.
   */
  public static function validate(): Void {
    if (finalized)
      return;
    final modules = [for (module in ownersByModule.keys()) module];
    modules.sort(Reflect.compare);
    for (module in modules) {
      final owners = ownersByModule.get(module).copy();
      owners.sort((left, right) -> {
        final positionOrder = comparePosition(left.pos, right.pos);
        return positionOrder != 0 ? positionOrder : Reflect.compare(left.key,
          right.key);
      });
      if (owners.length > 1) {
        CompilerDiagnostic.fail('GENES-MODULE-DIRECTIVE-CONFLICT-001: module $module declares '
          + '@:genes.moduleDirective on both ${owners[0].key} and '
          + '${owners[1].key}; select one top-level declaration',
          owners[1].pos);
      }

      final unique: Array<ModuleDirective> = [];
      final seen = new Map<String, Bool>();
      for (directive in owners[0].directives) {
        if (seen.exists(directive.value))
          continue;
        seen.set(directive.value, true);
        unique.push(directive);
      }
      plans.set(module, new ModuleDirectivePlan(unique));
    }
    finalized = true;
  }

  /** Returns the immutable plan for one independently reachable module. */
  public static function forModule(module: String): ModuleDirectivePlan {
    validate();
    final plan = plans.get(module);
    return plan == null ? EMPTY : plan;
  }
}
