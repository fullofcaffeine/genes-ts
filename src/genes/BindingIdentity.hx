package genes;

import haxe.macro.Context;
import haxe.macro.Type;
import haxe.ds.ReadOnlyArray;
import genes.Dependencies.DependencySpec;
import genes.Dependencies.DependencyType;
import genes.SourceMapGenerator.SourcePosition;
import genes.util.TypeUtil;

/**
 * The exact export selected from one ECMAScript module request.
 *
 * Why: `import Foo from "pkg"` and `import {Foo} from "pkg"` use the same
 * module text and the same preferred local name, but they can refer to two
 * different JavaScript values. Treating the local word `Foo` as their identity
 * silently redirected one Haxe declaration to the other value.
 *
 * What: the three ESM binding forms remain distinct. A named selector retains
 * the exact exported root name; default and namespace selectors deliberately
 * do not borrow their local name as an export name.
 *
 * How: dependency planning compares this value structurally before allocating
 * a collision-safe local. Printers only choose the target syntax for the
 * already-selected form.
 */
enum ExportSelector {
  DefaultExport;
  NamedExport(exactName: String);
  NamespaceExport;
}

/**
 * One loader request, independent from the values imported from it.
 *
 * The request owns module evaluation and source order. `external` distinguishes
 * a literal package specifier from an internal Haxe module with the same text.
 * The optional attribute is part of loader identity. Source positions are kept
 * elsewhere because provenance must never split an otherwise equal request.
 */
class ModuleRequestKey {
  public final external: Bool;
  public final path: String;
  public final importAttributeType: Null<String>;

  public function new(external: Bool, path: String,
      importAttributeType: Null<String>) {
    this.external = external;
    this.path = path;
    this.importAttributeType = importAttributeType;
  }

  public function equals(other: ModuleRequestKey): Bool {
    return external == other.external && path == other.path
      && importAttributeType == other.importAttributeType;
  }
}

/** One exact ESM binding exposed by one module request. */
class ExportBindingKey {
  public final request: ModuleRequestKey;
  public final selector: ExportSelector;

  public function new(request: ModuleRequestKey, selector: ExportSelector) {
    this.request = request;
    this.selector = selector;
  }

  public function equals(other: ExportBindingKey): Bool {
    return request.equals(other.request)
      && BindingIdentity.selectorsEqual(selector, other.selector);
  }
}

/**
 * The local name requested for one exact export, before collision suffixes.
 *
 * Why: two Haxe declarations may intentionally describe the same JavaScript
 * export. They share one emitted import when they request the same local, but
 * an explicit `@:genes.importAlias` may validly ask for a second local spelling.
 * Declaration identity therefore cannot be folded into export equality, and
 * requested-local intent cannot be discarded either.
 */
class LocalBindingIntent {
  public final exportBinding: ExportBindingKey;
  public final requestedLocal: String;

  public function new(exportBinding: ExportBindingKey,
      requestedLocal: String) {
    this.exportBinding = exportBinding;
    this.requestedLocal = requestedLocal;
  }

  public function equals(other: LocalBindingIntent): Bool {
    return exportBinding.equals(other.exportBinding)
      && requestedLocal == other.requestedLocal;
  }
}

/** The Haxe declaration kind retained for readable, collision-free identity. */
enum abstract HaxeDeclarationKind(String) to String {
  var ClassDecl = "class";
  var EnumDecl = "enum";
  var TypedefDecl = "typedef";
  var AbstractDecl = "abstract";
}

/**
 * Stable identity for one typed Haxe declaration during a compilation.
 *
 * The key uses declaration kind plus the full Haxe module/name. It contains no
 * `ModuleType` reference, source position, or process-global counter, so it can
 * be copied safely into each output projection and compared deterministically.
 */
class HaxeDeclarationKey {
  public final kind: HaxeDeclarationKind;
  public final module: String;
  public final name: String;

  public function new(kind: HaxeDeclarationKind, module: String,
      name: String) {
    this.kind = kind;
    this.module = module;
    this.name = name;
  }

  public function equals(other: HaxeDeclarationKey): Bool {
    return kind == other.kind && module == other.module && name == other.name;
  }

  public function describe(): String {
    return '$kind:$module.$name';
  }

  public static function fromModuleType(type: ModuleType): HaxeDeclarationKey {
    return switch type {
      case TClassDecl(ref): fromBase(ClassDecl, ref.get());
      case TEnumDecl(ref): fromBase(EnumDecl, ref.get());
      case TTypeDecl(ref): fromBase(TypedefDecl, ref.get());
      case TAbstract(ref): fromBase(AbstractDecl, ref.get());
    }
  }

  /**
   * Recovers a declaration kind when an older emitter API supplies `BaseType`.
   *
   * Haxe's shared `BaseType` structure does not expose whether it came from a
   * class, enum, typedef, or abstract. The compiler does retain that fact in the
   * owning module, so this lookup compares the exact full declaration name and
   * returns the typed module entry. It never guesses from metadata or uses a
   * cast to inspect a runtime object shape.
   */
  public static function fromBaseType(base: BaseType): HaxeDeclarationKey {
    final result = tryFromBaseType(base);
    if (result != null)
      return result;
    final fullName = TypeUtil.baseTypeFullName(base);
    return CompilerDiagnostic.fail(
      'GENES-IMPORT-ORIGIN-MISSING-001: could not recover the typed declaration for $fullName',
      base.pos);
  }

  /** Returns null for compiler-created local aliases with no ModuleType owner. */
  public static function tryFromBaseType(base: BaseType): Null<HaxeDeclarationKey> {
    for (candidate in Context.getModule(base.module)) {
      final candidateKey = switch candidate {
        case TInst(ref, _): fromBase(ClassDecl, ref.get());
        case TEnum(ref, _): fromBase(EnumDecl, ref.get());
        case TType(ref, _): fromBase(TypedefDecl, ref.get());
        case TAbstract(ref, _): fromBase(AbstractDecl, ref.get());
        default: null;
      }
      if (candidateKey != null && candidateKey.module == base.module
        && candidateKey.name == base.name)
        return candidateKey;
    }
    return null;
  }

  static function fromBase(kind: HaxeDeclarationKind,
      base: BaseType): HaxeDeclarationKey {
    return new HaxeDeclarationKey(kind, base.module, base.name);
  }
}

/**
 * Stable identity for a compiler-visible static or module-level field.
 *
 * A field-level `@:jsRequire` has no independent `ModuleType`, so the owning
 * class/module plus the exact field name supplies the same kind of typed lookup
 * that a declaration key supplies for an extern class. Source position is not
 * included: moving the field must not change which JavaScript value it means.
 */
class StaticFieldOriginKey {
  public final ownerModule: String;
  public final ownerName: String;
  public final fieldName: String;

  public function new(ownerModule: String, ownerName: String,
      fieldName: String) {
    this.ownerModule = ownerModule;
    this.ownerName = ownerName;
    this.fieldName = fieldName;
  }

  public function equals(other: StaticFieldOriginKey): Bool {
    return ownerModule == other.ownerModule && ownerName == other.ownerName
      && fieldName == other.fieldName;
  }

  public function describe(): String {
    return 'static-field:$ownerModule.$ownerName.$fieldName';
  }
}

/**
 * Reviewed compiler-created imports that have no Haxe declaration owner.
 *
 * New values must name one concrete compiler feature. A generic counter or
 * source-position ID would make output depend on traversal state and would hide
 * which code path is allowed to create the import.
 */
enum abstract CompilerCapabilityId(String) to String {
  var JsxRuntimeNamespace = "jsx-runtime-namespace";
}

/**
 * The typed compiler fact whose expression or annotation needs an import.
 *
 * Origins deliberately do not participate in export or local-binding equality:
 * several declarations may honestly denote one JavaScript value. They instead
 * provide the exact reverse lookup from typed Haxe use to its allocated local.
 */
enum BindingOriginKey {
  HaxeDeclaration(key: HaxeDeclarationKey);
  StaticField(key: StaticFieldOriginKey);
  CompilerCapability(id: CompilerCapabilityId);
}

/**
 * Connects one typed compiler origin to an imported root and optional members.
 *
 * `memberPath` is read-only because every output profile must use the exact
 * normalized suffix. For `Dropdown.Menu`, allocation may rename the imported
 * root to `Dropdown__1`; lookup then produces `Dropdown__1.Menu`. The suffix is
 * copied on construction so later metadata or array mutation cannot change the
 * already-planned meaning.
 */
class OriginBindingMapping {
  public final origin: BindingOriginKey;
  public final localIntent: LocalBindingIntent;
  public final memberPath: ReadOnlyArray<String>;

  public function new(origin: BindingOriginKey,
      localIntent: LocalBindingIntent, memberPath: Array<String>) {
    this.origin = origin;
    this.localIntent = localIntent;
    this.memberPath = memberPath.copy();
  }
}

/**
 * Immutable import meaning created before projection-specific alias allocation.
 *
 * Every output surface copies this object unchanged. Only the final local name
 * is chosen later because classic runtime, genes-ts, and classic declarations
 * can have different reachable binding subsets and therefore different lexical
 * collisions.
 */
class ImportBindingFact {
  public final exportBinding: ExportBindingKey;
  public final localIntent: LocalBindingIntent;
  public final originMapping: OriginBindingMapping;
  public final firstPosition: Null<SourcePosition>;

  public function new(exportBinding: ExportBindingKey,
      localIntent: LocalBindingIntent, originMapping: OriginBindingMapping,
      firstPosition: Null<SourcePosition>) {
    this.exportBinding = exportBinding;
    this.localIntent = localIntent;
    this.originMapping = originMapping;
    this.firstPosition = firstPosition;
  }
}

/**
 * Pure structural helpers for canonical import identity.
 *
 * Why: Haxe maps use object identity for class keys and enum equality is easy
 * to apply too broadly. These helpers compare the reviewed semantic fields
 * explicitly, so adding a field requires a visible compiler decision instead
 * of silently changing de-duplication.
 */
class BindingIdentity {
  /** Builds export/local identity without inventing an origin for a Haxe alias. */
  public static function localIntentFor(spec: DependencySpec): LocalBindingIntent {
    final request = new ModuleRequestKey(spec.external, spec.path,
      spec.importAttributeType);
    final exportBinding = new ExportBindingKey(request, selectorFor(spec));
    final requestedLocal = spec.alias == null ? spec.name : spec.alias;
    return new LocalBindingIntent(exportBinding, requestedLocal);
  }

  public static function create(spec: DependencySpec,
      origin: BindingOriginKey): ImportBindingFact {
    final localIntent = localIntentFor(spec);
    final exportBinding = localIntent.exportBinding;
    final mapping = new OriginBindingMapping(origin, localIntent,
      spec.memberPath);
    return new ImportBindingFact(exportBinding, localIntent, mapping, spec.pos);
  }

  public static function selectorFor(spec: DependencySpec): ExportSelector {
    return switch spec.type {
      case DDefault: DefaultExport;
      case DName: NamedExport(spec.name);
      case DAsterisk: NamespaceExport;
    }
  }

  public static function selectorsEqual(left: ExportSelector,
      right: ExportSelector): Bool {
    return switch [left, right] {
      case [DefaultExport, DefaultExport] | [NamespaceExport, NamespaceExport]:
        true;
      case [NamedExport(leftName), NamedExport(rightName)]:
        leftName == rightName;
      default: false;
    }
  }

  public static function originsEqual(left: BindingOriginKey,
      right: BindingOriginKey): Bool {
    return switch [left, right] {
      case [HaxeDeclaration(leftKey), HaxeDeclaration(rightKey)]:
        leftKey.equals(rightKey);
      case [StaticField(leftKey), StaticField(rightKey)]:
        leftKey.equals(rightKey);
      case [CompilerCapability(leftId), CompilerCapability(rightId)]:
        leftId == rightId;
      default: false;
    }
  }

  public static function originDescription(origin: BindingOriginKey): String {
    return switch origin {
      case HaxeDeclaration(key): key.describe();
      case StaticField(key): key.describe();
      case CompilerCapability(id): 'compiler-capability:$id';
    }
  }

  public static function memberPathsEqual(left: ReadOnlyArray<String>,
      right: ReadOnlyArray<String>): Bool {
    if (left.length != right.length)
      return false;
    for (index in 0...left.length)
      if (left[index] != right[index])
        return false;
    return true;
  }

  /** Same selector and requested local, deliberately ignoring the attribute. */
  public static function attributeConflictKeyEquals(left: LocalBindingIntent,
      right: LocalBindingIntent): Bool {
    final leftExport = left.exportBinding;
    final rightExport = right.exportBinding;
    return leftExport.request.external == rightExport.request.external
      && leftExport.request.path == rightExport.request.path
      && selectorsEqual(leftExport.selector, rightExport.selector)
      && left.requestedLocal == right.requestedLocal;
  }
}
