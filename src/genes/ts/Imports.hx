package genes.ts;

#if macro
import haxe.crypto.Md5;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;

using haxe.macro.TypeTools;
#end

/**
 * genes-ts import helper.
 *
 * Goal: make consuming existing JS/TS/TSX modules ergonomic from Haxe, while still
 * going through Genes' normal `@:jsRequire(...)` dependency tracking so we get
 * proper ESM imports in both output modes:
 * - classic Genes JS output
 * - genes-ts TypeScript output
 *
 * This is a macro-based helper. It defines hidden extern types with `@:jsRequire`
 * and returns a typed expression referencing the imported value.
 *
 * NOTE: We intentionally avoid naming this module `Import` because `import.hx`
 * is a special filename in Haxe (and macOS' default case-insensitive FS makes
 * `Import.hx` collide with it).
 */
class Imports {
  /**
   * The metadata on each holder class that names the module whose typing
   * made it (`ensureExternImportType`). `genes.incremental.HaxeDependencies`
   * and `genes.incremental.ModuleRequest` read it.
   */
  public static inline final HOLDER_DEFINER_META = ':genes.importDefiner';

  /**
   * The dotted package of every holder class that `ensureExternImportType`
   * (called by `importImpl`) defines.
   * `genes.incremental.HaxeDependencies` counts only classes in this package
   * as holders, so both sides read this one constant.
   */
  public static inline final HOLDER_PACKAGE = 'genes.ts.imports';

  /**
   * Import a module's default export.
   *
   * Example:
   *   final Button = Imports.defaultImport("./components/Button.tsx");
   */
  public static macro function defaultImport<T>(module: ExprOf<String>,
      ?as: ExprOf<String>): ExprOf<T> {
    return importImpl(module, Default, null, as, null);
  }

  /**
   * Import a module's default export with a TypeScript import attribute.
   *
   * Why: NodeNext/Bun/bundler resources such as JSON or file assets often need
   * `with { type: "..." }` on the generated import. Modeling this in the helper
   * keeps the import tracked by Genes instead of relying on ad hoc
   * `js.Syntax.code(...)` strings.
   *
   * What: the macro defines a hidden extern with both `@:jsRequire` and
   * `@:genes.importAttributeType(...)`. The TypeScript emitter turns that metadata
   * into an import shaped like:
   *
   *   import Theme from "./theme.json" with { type: "json" }
   *
   * How: both arguments must be string literals so dependency identity, aliasing,
   * and snapshot output remain deterministic.
   */
  public static macro function defaultImportWith<T>(module: ExprOf<String>,
      importType: ExprOf<String>, ?as: ExprOf<String>): ExprOf<T> {
    return importImpl(module, Default, null, as, importType);
  }

  /**
   * Import a text-like resource as a string default export.
   *
   * Why: many JS/Bun/bundler projects expose `.txt`, `.md`, or similar assets
   * as default string imports. This helper names that resource contract directly
   * instead of making Haxe code repeat a generic default-import spell at every
   * call site.
   *
   * What/How: this emits the same tracked default import as `defaultImport`,
   * typed as `String` on the Haxe side. The target project still owns the
   * runtime loader or bundler declaration for the imported extension.
   */
  public static macro function text(module: ExprOf<String>,
      ?as: ExprOf<String>): ExprOf<String> {
    return importImpl(module, Default, null, as, null);
  }

  /**
   * Import a file-like asset as a runtime path string.
   *
   * Why: Bun and several bundlers support `with { type: "file" }` for assets
   * where the program needs a path/URL string instead of the file contents.
   *
   * What/How: this emits a tracked default import with the TypeScript import
   * attribute `with { type: "file" }`, typed as `String` in Haxe. The runtime
   * meaning of the returned string remains the host loader's contract.
   */
  public static macro function file(module: ExprOf<String>,
      ?as: ExprOf<String>): ExprOf<String> {
    return importImpl(module, Default, null, as, macro "file");
  }

  // Keep the JS Promise signature out of non-JS target typing so the portable
  // side-effect helper below can report its own explicit target diagnostic.

  #if (js || macro)
  /**
   * Dynamically import a resource with a TypeScript import attribute.
   *
   * Why: binary resources such as WASM are often loaded lazily and may not have
   * ordinary TypeScript module declarations. `import("asset" as string, { with:
   * { type: "wasm" } })` keeps the specifier visible to Bun/bundlers while
   * avoiding a TypeScript module-resolution requirement for the raw asset path.
   *
   * What: the caller supplies the expected module shape, commonly
   * `{ default: string }` for loaders that return a path/URL string.
   *
   * How: arguments must be string literals so the generated expression remains
   * deterministic. The macro only constructs the dynamic import expression; it
   * does not copy, bundle, or interpret the asset.
   */
  public static macro function dynamicWith<T>(module: ExprOf<String>,
      importType: ExprOf<String>): ExprOf<js.lib.Promise<T>> {
    return dynamicImportImpl(module, importType);
  }

  /**
   * Convenience wrapper for `dynamicWith(module, "wasm")`.
   */
  public static macro function dynamicWasm<T>(module: ExprOf<String>): ExprOf<js.lib.Promise<T>> {
    return dynamicImportImpl(module, macro "wasm");
  }
  #end

  /**
   * Import a named export from a module.
   *
   * Example:
   *   final render = Imports.namedImport("react-dom/server", "renderToStaticMarkup");
   */
  public static macro function namedImport<T>(module: ExprOf<String>,
      exportName: ExprOf<String>, ?as: ExprOf<String>): ExprOf<T> {
    return importImpl(module, Named, exportName, as, null);
  }

  /**
   * Import a module namespace (`import * as X from "mod"`).
   *
   * Example:
   *   final Path = Imports.namespaceImport("node:path");
   *   Path.join("a", "b");
   */
  public static macro function namespaceImport<T>(module: ExprOf<String>,
      ?as: ExprOf<String>): ExprOf<T> {
    return importImpl(module, Namespace, null, as, null);
  }

  /**
   * Requests a module for its initialization effects without importing a value.
   *
   * Why: Haxe has no binding-free ESM import expression. A fake default or
   * namespace binding would assume an export shape and could leak a value into
   * generated APIs, while raw target syntax would bypass dependency planning,
   * source maps, extension policy, and the shared TS/classic architecture.
   *
   * What: in either Genes output profile this direct initializer statement
   * becomes `import "module"`. Repeated identical requests execute once at the
   * first request position, following ESM module identity semantics.
   *
   * How: the macro accepts one non-empty string literal and expands to a typed,
   * effectful compiler marker. Haxe retains that call through full DCE; Genes
   * consumes it into the ordered dependency plan and erases the call from
   * implementation and declaration output. It is valid only as a direct outer
   * statement of `static function __init__():Void` while the Genes JS generator
   * is active. Unsupported targets fail explicitly instead of dropping module
   * initialization.
   */
  public static macro function sideEffect(module: ExprOf<String>): ExprOf<Void> {
    return sideEffectImpl(module, null);
  }

  /**
   * Requests side-effect initialization with one ESM `type` attribute.
   *
   * Why/What: resource loaders may distinguish requests such as JSON by the
   * declaration-wide `with { type: "json" }` contract. The attribute is part of
   * request identity and therefore cannot be reconstructed safely by a printer.
   *
   * How: both arguments must be non-empty literals. The typed marker carries
   * those immutable facts into the same ordered plan used by `sideEffect`; no
   * target-language string, imported token, `Dynamic`, or `untyped` boundary is
   * introduced.
   */
  public static macro function sideEffectWith(module: ExprOf<String>,
      importType: ExprOf<String>): ExprOf<Void> {
    return sideEffectImpl(module, importType);
  }

  #if macro
  /**
   * Builds the same tracked default-import expression as `defaultImport`.
   *
   * This is a compiler-extension seam, not an application API. Small typed
   * helpers such as `genes.css.CssModule` can add their own compile-time checks
   * and then reuse Genes' one import path. Keeping that path shared prevents
   * aliases, dependency ordering, TypeScript output, and classic JavaScript
   * output from slowly developing different rules.
   */
  @:noCompletion
  public static function defaultImportExpression(moduleExpr: Expr,
      asExpr: Null<Expr>): Expr {
    return importImpl(moduleExpr, Default, null, asExpr, null);
  }

  static function sideEffectImpl(moduleExpr: Expr,
      importAttributeTypeExpr: Null<Expr>): Expr {
    final callPos = Context.currentPos();
    if (!Context.defined('js')
      || !Context.defined(genes.CompilerInternal.GENERATOR_ACTIVE_DEFINE)) {
      Context.error('GENES-SIDE-EFFECT-IMPORT-TARGET-001: Imports.sideEffect requires the active Genes JS generator',
        callPos);
    }
    if (Context.getLocalMethod() != '__init__') {
      Context.error('GENES-SIDE-EFFECT-IMPORT-CONTEXT-001: Imports.sideEffect must be a direct outer statement of static function __init__()',
        callPos);
    }

    final module = expectSideEffectLiteral(moduleExpr,
      'GENES-SIDE-EFFECT-IMPORT-LITERAL-001: module specifier must be a non-empty string literal');
    final importAttributeType = if (importAttributeTypeExpr == null) null else
      expectSideEffectLiteral(importAttributeTypeExpr,
      'GENES-SIDE-EFFECT-IMPORT-ATTRIBUTE-001: import attribute type must be a non-empty string literal');
    final attributeExpr: Expr = importAttributeType == null ? macro null : macro $v{importAttributeType};
    return
      macro @:pos(callPos) genes.internal.SideEffectImportMarker.external($v{module},
        $attributeExpr);
  }

  static function importImpl(moduleExpr: Expr, kind: ImportKind,
      exportExpr: Null<Expr>, asExpr: Null<Expr>,
      importAttributeTypeExpr: Null<Expr>): Expr {
    final pos = moduleExpr.pos;
    final module = expectStringLiteral(moduleExpr, 'module');
    final exportName = exportExpr != null ? expectStringLiteral(exportExpr,
      'exportName') : null;
    final explicitAs = optionalStringLiteral(asExpr, 'as');
    final importAttributeType = optionalStringLiteral(importAttributeTypeExpr,
      'importType');

    final inMethod = Context.getLocalMethod() != null;

    final inferredAs = inferAlias(kind, module, exportName);
    final desiredAlias = explicitAs != null ? explicitAs : inferredAs;

    final importAlias = if (inMethod) internalAlias(desiredAlias) else
      desiredAlias;

    final dotted = exportName != null && exportName.indexOf('.') > -1;
    final exportRoot = dotted ? exportName.split('.')[0] : exportName;
    final needsNativeRewrite = dotted && inMethod;

    final native: Null<String> = if (needsNativeRewrite) {
      // Genes imports the first segment (`Dropdown`) and normally uses the dotted
      // name (`Dropdown.Menu`) as the access path. If we alias the import in a
      // local-scope-safe way, we must also rewrite the dotted access to match.
      final suffix = exportName.substr(exportRoot.length); // includes leading '.'
      importAlias + suffix;
    } else null;

    final typePath = ensureExternImportType({
      kind: kind,
      module: module,
      exportName: exportName,
      exportRoot: exportRoot,
      importAlias: importAlias,
      native: native,
      importAttributeType: importAttributeType,
      pos: pos
    });

    final ref: Expr = macro $p{typePath.pack.concat([typePath.name])};
    // `ref` is a type-expression (a class), which Haxe types as `Class<T>`.
    // For imports we want a *value* that can be treated as an arbitrary target
    // type (structural, function type, etc.) without generating runtime casts.
    //
    // `js.Syntax.code("{0}", ref)` lowers to just the identifier in output,
    // but is typed as `Dynamic` by Haxe, letting us apply an `ECheckType` to
    // provide the desired type to downstream code.
    final valueExpr: Expr = macro js.Syntax.code("{0}", $ref);

    final expected = Context.getExpectedType();
    final ct = expected != null ? expected.toComplexType() : null;
    if (ct == null)
      return valueExpr;
    return {
      expr: ECheckType(valueExpr, ct),
      pos: pos
    };
  }

  static function dynamicImportImpl(moduleExpr: Expr,
      importAttributeTypeExpr: Expr): Expr {
    final pos = moduleExpr.pos;
    final module = expectStringLiteral(moduleExpr, 'module');
    final importAttributeType = expectStringLiteral(importAttributeTypeExpr,
      'importType');
    final valueExpr: Expr = macro js.Syntax.code($v{'import(${tsStringLiteral(module)} as string, { with: { type: ${tsStringLiteral(importAttributeType)} } })'});
    final expected = Context.getExpectedType();
    final ct = expected != null ? expected.toComplexType() : null;
    if (ct == null)
      return valueExpr;
    return {
      expr: ECheckType(valueExpr, ct),
      pos: pos
    };
  }

  static function tsStringLiteral(value: String): String {
    final escapedSlash = StringTools.replace(value, '\\', '\\\\');
    return '"' + StringTools.replace(escapedSlash, '"', '\\"') + '"';
  }

  private static function expectStringLiteral(e: Expr, label: String): String {
    return switch e.expr {
      case EConst(CString(s, _)):
        s;
      default:
        Context.error('Import helper expects `$label` to be a string literal',
          e.pos);
    }
  }

  private static function expectSideEffectLiteral(e: Expr,
      diagnostic: String): String {
    return switch e.expr {
      case EConst(CString(value, _)) if (value.length > 0):
        value;
      default:
        Context.error(diagnostic, e.pos);
    }
  }

  private static function optionalStringLiteral(e: Null<Expr>,
      label: String): Null<String> {
    if (e == null)
      return null;
    return switch e.expr {
      case EConst(CIdent('null')):
        null;
      case EConst(CString(s, _)):
        s;
      default:
        Context.error('Import helper expects `$label` to be a string literal',
          e.pos);
    }
  }

  private static function internalAlias(base: String): String {
    final clean = sanitizeIdentifier(base);
    return '__genes_import_' + clean;
  }

  private static function inferAlias(kind: ImportKind, module: String,
      exportName: Null<String>): String {
    return switch kind {
      case Named:
        exportName != null ? sanitizeIdentifier(exportName.split('.')
          .pop()) : 'Import';
      case Default | Namespace:
        // Use the last path segment of the module specifier.
        final s = module.split('?')[0].split('#')[0];
        final last = s.split('/').pop();
        final noExt = stripKnownExtension(last);
        // Handle "index" style modules by using the parent folder when possible.
        final base = if (noExt == 'index' && s.indexOf('/') > -1)
          stripKnownExtension(s.split('/')[s.split('/')
          .length - 2]) else noExt;
        toPascalCase(base);
    }
  }

  private static function stripKnownExtension(name: String): String {
    for (ext in ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'])
      if (StringTools.endsWith(name, ext))
        return name.substr(0, name.length - ext.length);
    return name;
  }

  private static function toPascalCase(input: String): String {
    final parts = splitIdentifierParts(input);
    if (parts.length == 0)
      return 'Import';
    final out = new StringBuf();
    for (p in parts) {
      if (p.length == 0)
        continue;
      out.add(p.substr(0, 1).toUpperCase());
      out.add(p.substr(1));
    }
    return out.toString();
  }

  private static function sanitizeIdentifier(input: String): String {
    final parts = splitIdentifierParts(input);
    if (parts.length == 0)
      return 'Import';
    final out = new StringBuf();
    var first = true;
    for (p in parts) {
      if (p.length == 0)
        continue;
      if (first) {
        out.add(p.substr(0, 1));
        out.add(p.substr(1));
        first = false;
      } else {
        out.add(p.substr(0, 1).toUpperCase());
        out.add(p.substr(1));
      }
    }
    var s = out.toString();
    // Ensure it starts with a valid identifier char.
    final c0 = s.charCodeAt(0);
    final isAlpha = (c0 >= 'a'.code && c0 <= 'z'.code)
      || (c0 >= 'A'.code && c0 <= 'Z'.code);
    final isUnderscore = c0 == '_'.code;
    if (!isAlpha && !isUnderscore)
      s = '_' + s;
    return s;
  }

  private static function splitIdentifierParts(input: String): Array<String> {
    final re = ~/[A-Za-z0-9]+/g;
    final parts: Array<String> = [];
    var i = 0;
    while (re.matchSub(input, i)) {
      parts.push(re.matched(0));
      i = re.matchedPos().pos + re.matchedPos().len;
    }
    return parts;
  }

  /**
   * Returns the hidden extern holder class for one import of the module that
   * Haxe is typing, and defines it on first use.
   *
   * A holder is an extern class in `HOLDER_PACKAGE` whose metadata
   * (`@:jsRequire`, `@:genes.importAlias`) makes Genes print the import.
   * Everything about a holder comes from two facts only: the import and the
   * module whose typing makes it (the definer). Its name is a digest of
   * both. Its position, which the import line of the source map names, is
   * the start of the definer's file (line 1, column 1), not the call site.
   *
   * Why the name includes the definer (genes-f8vc.14.43): when two modules
   * share one holder, Haxe makes it while it types whichever module comes
   * first, and a warm compilation server does not always type the modules
   * in the order of a cold build. So every module makes its own holder, and
   * no edit of one module can change the holder of another.
   *
   * Why the position is fixed (genes-f8vc.14.43, review round 2): one
   * module can call `Imports` for the same import in two functions. Haxe
   * types a function body when something first uses it, so which call Haxe
   * types first depends on the rest of the program. A call-site position
   * would then change with an edit of another module (`Main` calls `one()`
   * instead of `two()`), and a warm server would keep the old one
   * (`probe9f-holder-position-full` and the other `probe9f` rows).
   *
   * Two holders with the same import in one module share one import line
   * (`Dependencies.pushAndGet` keeps the first in plan order), for example
   * a module's own holder and one that an inline call of another module
   * brings in. That line names the start of the first holder's definer
   * file.
   */
  private static function ensureExternImportType(spec: ImportTypeSpec): TypePath {
    // The module that Haxe is typing, which makes this holder. Haxe gives
    // the holder that module's file (`define_type` in `macroContext.ml`).
    final definer = Context.getLocalModule();
    final key = (switch spec.kind {
      case Default: 'default';
      case Named: 'named';
      case Namespace: 'namespace';
    })
      + '|'
      + spec.module
      + '|'
      + (spec.exportName != null ? spec.exportName : '')
      + '|'
      + spec.importAlias
      + '|'
      + (spec.native != null ? spec.native : '')
      + '|'
      + (spec.importAttributeType != null ? spec.importAttributeType : '')
      + '|'
      + definer;

    final hash = Md5.encode(key).substr(0, 12);
    final pack = HOLDER_PACKAGE.split('.');
    final name = 'Import_${hash}';
    final fullName = pack.join('.') + '.' + name;

    try {
      Context.getType(fullName);
      return {pack: pack, name: name, params: []};
    } catch (_:Dynamic) {
      // Define it below.
    }
    final pos = holderPosition(spec.pos);

    final meta: Metadata = [];
    // Drive Genes' import generation.
    switch spec.kind {
      case Default:
        meta.push({
          name: ':jsRequire',
          params: [macro $v{spec.module}, macro $v{'default'}],
          pos: pos
        });
      case Namespace:
        meta.push({
          name: ':jsRequire',
          params: [macro $v{spec.module}],
          pos: pos
        });
      case Named:
        meta.push({
          name: ':jsRequire',
          params: [macro $v{spec.module}, macro $v{spec.exportName}],
          pos: pos
        });
    }

    meta.push({
      name: ':genes.importAlias',
      params: [macro $v{spec.importAlias}],
      pos: pos
    });

    // Record the module that makes this holder, so
    // `genes.incremental.HaxeDependencies` can count the holder's entry of
    // Haxe's dependency list with that module (genes-f8vc.14.41). Example:
    // `@:genes.importDefiner("app.ui.Card")`.
    meta.push({
      name: HOLDER_DEFINER_META,
      params: [macro $v{definer}],
      pos: pos
    });

    if (spec.native != null) {
      meta.push({
        name: ':native',
        params: [macro $v{spec.native}],
        pos: pos
      });
    }

    if (spec.importAttributeType != null) {
      meta.push({
        name: ':genes.importAttributeType',
        params: [macro $v{spec.importAttributeType}],
        pos: pos
      });
    }

    final def: TypeDefinition = {
      pack: pack,
      name: name,
      pos: pos,
      meta: meta,
      isExtern: true,
      kind: TDClass(null, [], false, false, false),
      fields: []
    };

    Context.defineType(def);
    return {pack: pack, name: name, params: []};
  }

  /**
   * Returns the position of a new holder: the start of the file of the class
   * that Haxe is typing, so of the definer's file. Example: a call in
   * `src/app/ui/Card.hx` gives `src/app/ui/Card.hx` at offset 0.
   *
   * Why not the call site: see `ensureExternImportType`. Why the local class
   * and not `callPos`: a macro that returns an `Imports` call can give the
   * call a position in the macro's own file, so two calls of one module
   * could name two files. The local class belongs to the definer, and its
   * position does not depend on which call Haxe types first. Without a
   * local class (an init macro, whose definer is empty), the file of
   * `callPos` is used.
   */
  static function holderPosition(callPos: Position): Position {
    final local = Context.getLocalClass();
    final file = Context.getPosInfos(local == null ? callPos : local.get().pos)
      .file;
    return Context.makePosition({file: file, min: 0, max: 0});
  }
  #end
}

#if macro
private enum ImportKind {
  Default;
  Named;
  Namespace;
}

private typedef ImportTypeSpec = {
  final kind: ImportKind;
  final module: String;
  final exportName: Null<String>;
  final exportRoot: Null<String>;
  final importAlias: String;
  final native: Null<String>;
  final importAttributeType: Null<String>;
  final pos: Position;
}
#end
