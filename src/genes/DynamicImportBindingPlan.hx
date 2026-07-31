package genes;

#if macro
import genes.BindingIdentity.HaxeDeclarationKey;
import genes.BindingIdentity.StaticFieldOriginKey;
import haxe.macro.Context;
import haxe.macro.Expr.Position;

using Lambda;

/**
 * Encodes the exact fixed bindings created inside `Genes.dynamicImport`.
 *
 * Why: a lazy callback's local alias can differ from the export read from its
 * namespace, and selected functions need exact owner/field identity. Bare
 * names cannot distinguish those facts or safely suppress static imports.
 *
 * What/How: the macro serializes one versioned compiler-owned token per fixed
 * binding. Generator consumers decode it immediately and compare structured
 * declaration/static-field identities. The token transports an already typed
 * decision; its text is never used as the semantic proof.
 */
enum DynamicImportBindingToken {
  Declaration(kind: String, module: String, name: String, localName: String,
    exportName: String);
  StaticField(ownerModule: String, ownerName: String, fieldName: String,
    localName: String, exportName: String);
}

/** One fixed callback binding in typed argument/first-occurrence order. */
class DynamicImportBinding {
  public final moduleIndex: Int;
  public final token: DynamicImportBindingToken;

  public function new(moduleIndex: Int, token: DynamicImportBindingToken) {
    this.moduleIndex = moduleIndex;
    this.token = token;
  }

  public function localName(): String {
    return switch token {
      case Declaration(_, _, _, localName, _) |
        StaticField(_, _, _, localName, _):
        localName;
    }
  }

  public function exportName(): String {
    return switch token {
      case Declaration(_, _, _, _, exportName) |
        StaticField(_, _, _, _, exportName):
        exportName;
    }
  }

  public function originKey(): String {
    return switch token {
      case Declaration(kind, module, name, _, _):
        'declaration:$kind:$module:$name';
      case StaticField(ownerModule, ownerName, fieldName, _, _):
        'static-field:$ownerModule:$ownerName:$fieldName';
    }
  }

  public function originDescription(): String {
    return switch token {
      case Declaration(kind, module, name, _, _):
        '$kind $module.$name';
      case StaticField(ownerModule, ownerName, fieldName, _, _):
        '$ownerModule.$ownerName.$fieldName';
    }
  }

  public function encoded(): String {
    return DynamicImportBindingPlan.encode(token);
  }
}

class DynamicImportBindingPlan {
  static final PREFIX = 'genes.dynamic-binding|1|';

  final entries: Array<DynamicImportBinding>;

  public static function declaration(moduleIndex: Int,
      key: HaxeDeclarationKey, localName: String,
      exportName: String): DynamicImportBinding {
    return new DynamicImportBinding(moduleIndex,
      Declaration(Std.string(key.kind), key.module, key.name, localName,
        exportName));
  }

  public static function staticField(moduleIndex: Int,
      key: StaticFieldOriginKey, localName: String,
      exportName: String): DynamicImportBinding {
    return new DynamicImportBinding(moduleIndex,
      StaticField(key.ownerModule, key.ownerName, key.fieldName, localName,
        exportName));
  }

  /**
   * Freezes the callback namespace and rejects two origins claiming one local.
   *
   * Exact duplicate occurrences coalesce. The same origin may intentionally
   * appear under distinct aliases, and equal namespace export names do not
   * collide when their callback-local aliases differ.
   */
  public static function build(candidates: Array<DynamicImportBinding>,
      pos: Position, ?reserved: Map<String, String>): DynamicImportBindingPlan {
    final entries: Array<DynamicImportBinding> = [];
    final locals = new Map<String, DynamicImportBinding>();
    if (reserved != null)
      for (localName => description in reserved) {
        final conflicting = candidates.find(candidate ->
          candidate.localName() == localName);
        if (conflicting != null)
          Context.error('GENES-DYNAMIC-IMPORT-BINDING-COLLISION-002: '
            + 'Genes.dynamicImport cannot create two callback-local bindings '
            + 'named "$localName" ($description and '
            + '${conflicting.originDescription()})',
            pos);
      }
    for (candidate in candidates) {
      final localName = candidate.localName();
      final prior = locals.get(localName);
      if (prior == null) {
        locals.set(localName, candidate);
        entries.push(candidate);
      } else if (prior.originKey() != candidate.originKey()) {
        Context.error('GENES-DYNAMIC-IMPORT-BINDING-COLLISION-002: '
          + 'Genes.dynamicImport cannot create two callback-local bindings '
          + 'named "$localName" (${prior.originDescription()} and '
          + '${candidate.originDescription()})',
          pos);
      }
    }
    return new DynamicImportBindingPlan(entries);
  }

  public function new(entries: Array<DynamicImportBinding>) {
    this.entries = entries.copy();
  }

  public function allEntries(): Array<DynamicImportBinding> {
    return entries.copy();
  }

  public function entriesForModule(index: Int): Array<DynamicImportBinding> {
    return entries.filter(entry -> entry.moduleIndex == index);
  }

  public static function encode(token: DynamicImportBindingToken): String {
    return switch token {
      case Declaration(kind, module, name, localName, exportName):
        PREFIX +
        ['declaration', kind, module, name, localName, exportName].join('|');
      case StaticField(ownerModule, ownerName, fieldName, localName,
        exportName):
        PREFIX
        +
        ['static-field', ownerModule, ownerName, fieldName, localName, exportName].join('|');
    }
  }

  public static function decode(value: String): Null<DynamicImportBindingToken> {
    if (!StringTools.startsWith(value, PREFIX))
      return null;
    final parts = value.substr(PREFIX.length).split('|');
    return switch parts {
      case ['declaration', kind, module, name, localName, exportName]:
        Declaration(kind, module, name, localName, exportName);
      case ['static-field', ownerModule, ownerName, fieldName, localName, exportName]:
        StaticField(ownerModule, ownerName, fieldName, localName, exportName);
      default:
        CompilerDiagnostic.fail('GENES-DYNAMIC-IMPORT-CARRIER-003: malformed '
          + 'compiler-owned dynamic-import binding token',
          haxe.macro.Context.currentPos());
    }
  }
}
#end
