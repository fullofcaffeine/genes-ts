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
   * Import a module's default export.
   *
   * Example:
   *   final Button = Imports.defaultImport("./components/Button.tsx");
   */
  public static macro function defaultImport<T>(module: ExprOf<String>,
      ?as: ExprOf<String>): ExprOf<T> {
    return importImpl(module, Default, null, as);
  }

  /**
   * Import a named export from a module.
   *
   * Example:
   *   final render = Imports.namedImport("react-dom/server", "renderToStaticMarkup");
   */
  public static macro function namedImport<T>(module: ExprOf<String>,
      exportName: ExprOf<String>, ?as: ExprOf<String>): ExprOf<T> {
    return importImpl(module, Named, exportName, as);
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
    return importImpl(module, Namespace, null, as);
  }

  #if macro
  static function importImpl(moduleExpr: Expr, kind: ImportKind,
      exportExpr: Null<Expr>, asExpr: Null<Expr>): Expr {
    final pos = moduleExpr.pos;
    final module = expectStringLiteral(moduleExpr, 'module');
    final exportName = exportExpr != null ? expectStringLiteral(exportExpr, 'exportName') : null;
    final explicitAs = optionalStringLiteral(asExpr, 'as');

    final inMethod = Context.getLocalMethod() != null;

    final inferredAs = inferAlias(kind, module, exportName);
    final desiredAlias = explicitAs != null ? explicitAs : inferredAs;

    final importAlias = if (inMethod) internalAlias(desiredAlias) else desiredAlias;

    final dotted = exportName != null && exportName.indexOf('.') > -1;
    final exportRoot = dotted ? exportName.split('.')[0] : exportName;
    final needsNativeRewrite = dotted && inMethod;

    final native: Null<String> = if (needsNativeRewrite) {
      // Genes imports the first segment (`Dropdown`) and normally uses the dotted
      // name (`Dropdown.Menu`) as the access path. If we alias the import in a
      // local-scope-safe way, we must also rewrite the dotted access to match.
      final suffix = exportName.substr(exportRoot.length); // includes leading '.'
      importAlias + suffix;
    } else
      null;

    final typePath = ensureExternImportType({
      kind: kind,
      module: module,
      exportName: exportName,
      exportRoot: exportRoot,
      importAlias: importAlias,
      native: native,
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

  private static function expectStringLiteral(e: Expr, label: String): String {
    return switch e.expr {
      case EConst(CString(s, _)):
        s;
      default:
        Context.error('Import helper expects `$label` to be a string literal', e.pos);
    }
  }

  private static function optionalStringLiteral(e: Null<Expr>, label: String): Null<String> {
    if (e == null)
      return null;
    return switch e.expr {
      case EConst(CIdent('null')):
        null;
      case EConst(CString(s, _)):
        s;
      default:
        Context.error('Import helper expects `$label` to be a string literal', e.pos);
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
        exportName != null ? sanitizeIdentifier(exportName.split('.').pop()) : 'Import';
      case Default | Namespace:
        // Use the last path segment of the module specifier.
        final s = module.split('?')[0].split('#')[0];
        final last = s.split('/').pop();
        final noExt = stripKnownExtension(last);
        // Handle "index" style modules by using the parent folder when possible.
        final base = if (noExt == 'index' && s.indexOf('/') > -1)
          stripKnownExtension(s.split('/')[s.split('/').length - 2])
        else
          noExt;
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
    final isAlpha = (c0 >= 'a'.code && c0 <= 'z'.code) || (c0 >= 'A'.code && c0 <= 'Z'.code);
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

  private static function ensureExternImportType(spec: ImportTypeSpec): TypePath {
    final key = (switch spec.kind {
      case Default: 'default';
      case Named: 'named';
      case Namespace: 'namespace';
    }) + '|' + spec.module + '|' + (spec.exportName != null ? spec.exportName : '')
      + '|' + spec.importAlias + '|' + (spec.native != null ? spec.native : '');

    final hash = Md5.encode(key).substr(0, 12);
    final pack = ['genes', 'ts', 'imports'];
    final name = 'Import_${hash}';
    final fullName = pack.join('.') + '.' + name;

    try {
      Context.getType(fullName);
      return {pack: pack, name: name, params: []};
    } catch (_: Dynamic) {
      // Define it below.
    }

    final meta: Metadata = [];
    // Drive Genes' import generation.
    switch spec.kind {
      case Default:
        meta.push({
          name: ':jsRequire',
          params: [macro $v{spec.module}, macro $v{'default'}],
          pos: spec.pos
        });
      case Namespace:
        meta.push({
          name: ':jsRequire',
          params: [macro $v{spec.module}],
          pos: spec.pos
        });
      case Named:
        meta.push({
          name: ':jsRequire',
          params: [macro $v{spec.module}, macro $v{spec.exportName}],
          pos: spec.pos
        });
    }

    meta.push({
      name: ':genes.importAlias',
      params: [macro $v{spec.importAlias}],
      pos: spec.pos
    });

    if (spec.native != null) {
      meta.push({
        name: ':native',
        params: [macro $v{spec.native}],
        pos: spec.pos
      });
    }

    final def: TypeDefinition = {
      pack: pack,
      name: name,
      pos: spec.pos,
      meta: meta,
      isExtern: true,
      kind: TDClass(null, [], false, false, false),
      fields: []
    };

    Context.defineType(def);
    return {pack: pack, name: name, params: []};
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
  final pos: Position;
}
#end
