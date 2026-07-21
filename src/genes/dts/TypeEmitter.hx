package genes.dts;

import genes.SourceMapGenerator;
import genes.ExternTypeContract;
import genes.NullishContract;
import genes.NullishContract.NullishMissingValue;
import haxe.macro.Type;
import haxe.macro.Context;
import haxe.macro.Expr;
import genes.util.IteratorUtil.*;
import genes.util.TypeUtil;
import haxe.Json;

using haxe.macro.Tools;

// From: https://github.com/nadako/hxtsdgen/blob/0d903cad7e5ca054d450eb58cd4b253b9da5773c/src/hxtsdgen/TypeRenderer.hx#L10

typedef TypeWriter = {
  function write(code: String): Void;
  function writeNewline(): Void;
  function emitComment(comment: String): Void;
  function increaseIndent(): Void;
  function decreaseIndent(): Void;
  function emitPos(pos: SourcePosition): Void;
  function includeType(type: Type): Void;
  function typeAccessor(type: TypeAccessor): String;
}

class TypeEmitter {
  /**
   * True only while printing a source type retained by SignatureCache.
   *
   * Haxe's dead-code elimination (DCE) can remove enum constants before this
   * printer runs. Ordinary late-stage types keep their existing conservative
   * output. A source type saved by `SignatureCache`, however, proves that the
   * enum abstract existed before that simplification, so it may use the saved
   * literal spelling while this narrowly scoped flag is active.
   */
  static var emittingCapturedSourceType = false;

  public static function emitCapturedSourceType(writer: TypeWriter, type: Type,
      wrap = true): Void {
    final previous = emittingCapturedSourceType;
    emittingCapturedSourceType = true;
    try {
      emitType(writer, type, wrap);
    } catch (error: haxe.Exception) {
      // A failed compiler-server build must not leave the next build in this
      // special mode. Restore the earlier state before the normal generator
      // transaction reports the original error and rolls back its files.
      emittingCapturedSourceType = previous;
      throw error;
    }
    emittingCapturedSourceType = previous;
  }

  static function unwrapExpr(e: TypedExpr): TypedExpr {
    var cur = e;
    while (cur != null) {
      switch cur.expr {
        case TMeta(_, e1) | TParenthesis(e1) | TCast(e1, _):
          cur = e1;
        default:
          return cur;
      }
    }
    return e;
  }

  static function unwrapMetaExpr(e: Expr): Expr {
    var cur = e;
    while (cur != null) {
      switch cur.expr {
        case EMeta(_, e1) | EParenthesis(e1) | ECast(e1, _):
          cur = e1;
        default:
          return cur;
      }
    }
    return e;
  }

  static function enumAbstractValueFromMeta(field: ClassField): Null<String> {
    if (field == null)
      return null;
    return switch field.meta.extract(':value') {
      case [{params: [p]}]:
        switch unwrapMetaExpr(p).expr {
          case EConst(CString(s)):
            Json.stringify(s);
          case EConst(CInt(i)):
            i;
          case EConst(CFloat(f)):
            f;
          case EConst(CIdent('true')):
            'true';
          case EConst(CIdent('false')):
            'false';
          default:
            null;
        }
      default:
        null;
    }
  }

  /**
   * Returns the closed TypeScript literal projection of an enum abstract.
   *
   * Why: both the type printer and `DependencyPlan` must agree on whether an
   * enum abstract is represented by its backing Haxe type. A closed literal
   * union has no backing-type dependency, while an open (`from`) abstract does.
   * Keeping that semantic choice here prevents dependency discovery from
   * reverse-engineering emitted text or forcing the printer through a sink.
   *
   * What/How: constants are read from the typed implementation (force-loading
   * the declaration when necessary), deduplicated, and sorted. `null` means the
   * abstract is not a closed literal set and callers must project its backing
   * type instead.
   */
  public static function enumAbstractLiteralUnion(ab: AbstractType): Null<Array<String>> {
    if (ab == null || ab.impl == null || !ab.meta.has(':enum'))
      return null;
    // A `from` conversion means arbitrary values of another type may enter the
    // abstract, so the declared enum constants are documentation/convenience,
    // not a closed value set. Emitting a TS literal union there would reject
    // legal Haxe programs such as `enum abstract ErrorCode(Int) from Int`.
    if (ab.from.length > 0)
      return null;

    inline function fullNameOf(t: AbstractType): String {
      final parts = t.module.split('.');
      final last = parts[parts.length - 1];
      return (last == t.name) ? t.module : (t.module + '.' + t.name);
    }

    function collectFrom(t: AbstractType): Array<String> {
      final impl = t.impl.get();
      if (impl == null)
        return [];

      final out: Array<String> = [];
      for (field in impl.statics.get()) {
        if (field == null)
          continue;
        // Enum abstract values are static variables with constant expressions.
        switch field.kind {
          case FVar(_, _):
          case _:
            continue;
        }
        final metaValue = enumAbstractValueFromMeta(field);
        if (metaValue != null) {
          out.push(metaValue);
          continue;
        }
        final e = field.expr();
        if (e == null)
          continue;
        switch unwrapExpr(e).expr {
          case TConst(TString(s)):
            out.push(Json.stringify(s));
          case TConst(TInt(i)):
            out.push(Std.string(i));
          case TConst(TFloat(s)):
            out.push(s);
          case TConst(TBool(b)):
            out.push(b ? 'true' : 'false');
          default:
        }
      }
      return out;
    }

    // Haxe may not type enum-abstract value initializers unless the module is
    // explicitly loaded. If we don't have any constants, force-load the type
    // and try again so we can still emit a TS literal union.
    var out = collectFrom(ab);
    if (out.length == 0) {
      final fullName = fullNameOf(ab);
      try {
        Context.getType(fullName);
      } catch (_: Dynamic) {}
      try {
        switch Context.getType(fullName) {
          case TAbstract(_.get() => reloaded, _):
            out = collectFrom(reloaded);
          default:
        }
      } catch (_: Dynamic) {}
    }

    if (out.length == 0)
      return null;

    // Deterministic output: keep unique + sorted.
    final seen = new Map<String, Bool>();
    final uniq: Array<String> = [];
    for (v in out) {
      if (!seen.exists(v)) {
        seen.set(v, true);
        uniq.push(v);
      }
    }
    uniq.sort(Reflect.compare);
    return uniq;
  }

  static function emitTypeOverride(writer: TypeWriter, template: String,
      params: Array<Type>) {
    final write = writer.write;
    var i = 0;
    while (i < template.length) {
      final idx = template.indexOf('$', i);
      if (idx == -1) {
        write(template.substr(i));
        break;
      }
      write(template.substr(i, idx - i));

      // Escape: `$$` -> `$`
      if (idx + 1 < template.length && template.charAt(idx + 1) == '$') {
        write('$');
        i = idx + 2;
        continue;
      }

      // Placeholder: `$0`, `$1`, ... expands to the corresponding type arg.
      var j = idx + 1;
      while (j < template.length) {
        final c = template.charCodeAt(j);
        if (c < '0'.code || c > '9'.code)
          break;
        j++;
      }
      if (j == idx + 1) {
        // Not a placeholder (e.g. `$Foo`), keep the `$` literal.
        write('$');
        i = idx + 1;
        continue;
      }

      final n = Std.parseInt(template.substr(idx + 1, j - (idx + 1)));
      if (n == null || n < 0 || n >= params.length) {
        // Invalid placeholder; keep literal so the TS compiler can surface it.
        write(template.substr(idx, j - idx));
      } else {
        emitType(writer, params[n]);
      }
      i = j;
    }
  }

  static function typeOverrideFromMeta(meta: MetaAccess): Null<String> {
    final tsOverride = switch meta.extract(':ts.type') {
      case [{params: [{expr: EConst(CString(type))}]}]: type;
      default: null;
    }
    final genesOverride = switch meta.extract(':genes.type') {
      case [{params: [{expr: EConst(CString(type))}]}]: type;
      default: null;
    }
    final overrideType = tsOverride != null ? tsOverride : genesOverride;
    if (overrideType == null && (meta.has(':ts.type') || meta.has(':genes.type')))
      throw '@:ts.type/@:genes.type needs an expression';
    return overrideType;
  }

  /**
   * Returns true when an array element type needs parentheses before `[]`.
   *
   * Why: TypeScript parses `A | B[]` as `A | (B[])`, not `(A | B)[]`.
   * Haxe abstracts such as `genes.ts.JsonValue` may emit a TS union through
   * `@:ts.type`, so array element rendering must account for raw type
   * overrides as well as ordinary `Null`/`EitherType` unions.
   */
  static function arrayElementNeedsParens(t: Type): Bool {
    return switch t {
      case TAbstract(_.get() => {pack: [], name: "Null"}, _) |
        TType(_.get() => {pack: [], name: "Null"}, _) |
        TAbstract(_.get() => {pack: ["haxe", "extern"], name: "EitherType"},
          _):
        true;
      case TAbstract(_.get() => ab, _) if (ab.meta.has(':enum')):
        final values = enumAbstractLiteralUnion(ab);
        if (values != null) {
          values.length > 1;
        } else {
          final cached = emittingCapturedSourceType
            && Context.defined('genes.ts')
            ? genes.ts.SignatureCache.getEnumAbstractTsType(ab)
            : null;
          cached != null && cached.indexOf('|') != -1;
        }
      case TInst(_.get().meta => meta, _) |
        TAbstract(_.get().meta => meta, _) |
        TType(_.get().meta => meta, _):
        final overrideType = typeOverrideFromMeta(meta);
        overrideType != null && overrideType.indexOf('|') != -1;
      case TLazy(f):
        arrayElementNeedsParens(f());
      default:
        false;
    }
  }

  /**
   * Emits one already-classified nullish type projection with correct TS
   * precedence.
   *
   * Why: appending `| undefined` directly to a function type changes its
   * meaning: `(value: string) => number | undefined` makes the *return value*
   * optional, while `((value: string) => number) | undefined` makes the
   * property optional. `@:ts.type` strings and cached projections are opaque
   * to this printer, so they are conservatively parenthesized when extended.
   *
   * What: the shared `NullishContract` decides whether the undefined member is
   * required. This target printer owns only TypeScript grouping and spelling.
   *
   * How: typed function members and opaque/raw projections are grouped before
   * the union suffix. Ordinary named and primitive types remain compact.
   */
  public static function emitNullishProjection(writer: TypeWriter,
      nullish: NullishContract, emitBase: Void->Void,
      opaqueBase = false): Void {
    final needsParens = nullish.needsUndefinedTypeProjection
      && (opaqueBase || switch nullish.emittedType {
        case TFun(_, _): true;
        case TLazy(resolve):
          switch resolve() {
            case TFun(_, _): true;
            default: false;
          }
        default: false;
      });
    if (needsParens)
      writer.write('(');
    emitBase();
    if (needsParens)
      writer.write(')');
    if (nullish.needsUndefinedTypeProjection)
      writer.write(' | undefined');
  }

  /**
   * Emits a declaration's own collision-safe name and generic parameters.
   *
   * Why: type-position projection may honestly replace an unsupported helper
   * reference with `any`, but a declaration identifier is an identity, not a
   * projected type. Applying that fallback after `export type` creates invalid
   * TypeScript such as `export type any` and leaves its generics unbound.
   *
   * What/How: declaration owners call this only for the left-hand name of a
   * type, class, interface, or enum declaration. The resolved accessor and
   * Haxe constraints are emitted verbatim. References, heritage clauses, and
   * payload types continue through `emitBaseType`/`emitType`, where target
   * fallbacks remain permitted.
   */
  public static function emitDeclarationBaseType(writer: TypeWriter,
      type: BaseType, params: Array<Type>, withConstraints = false) {
    writer.emitPos(type.pos);
    writer.write(writer.typeAccessor(type));
    emitParams(writer, params, withConstraints);
  }

  public static function emitBaseType(writer: TypeWriter, type: BaseType,
      params: Array<Type>, withConstraints = false) {
    final write = writer.write, emitPos = writer.emitPos;
    final accessor = writer.typeAccessor(type);
    // Some libraries reference helper types that may be stripped by DCE in runtime output.
    // If a referenced type won't be emitted, fall back to `any` to keep TS compiling.
    if (accessor == "RegroupStatus" || accessor == "RegroupResult") {
      emitPos(type.pos);
      write("any");
      return;
    }
    emitDeclarationBaseType(writer, type, params, withConstraints);
  }

  public static function emitParams(writer: TypeWriter, params: Array<Type>,
      withConstraints = false) {
    final write = writer.write;
    if (params.length > 0) {
      write('<');
      for (param in join(params, write.bind(', '))) {
        emitType(writer, param);
        if (withConstraints)
          switch param {
            case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
              if (constraints.length > 0) {
                write(' extends ');
                for (c in join(constraints, write.bind(' & ')))
                  emitType(writer, c);
              }
            default:
          }
      }
      write('>');
    }
  }

  /**
   * Emits the generic declaration owned by one enum constructor type alias.
   *
   * Why: a Haxe enum constructor may introduce a type parameter that does not
   * belong to the enum itself, such as `Payload<T>(value:T)`. That parameter
   * must remain available to the structural TypeScript variant or its payload
   * would widen to `any`.
   *
   * What: enum-level parameters are required and constructor-local parameters
   * follow them with a `never` default. TypeScript can therefore refer to a
   * variant with only the enum parameters when building the enclosing union,
   * while direct variant consumers can still supply the precise payload type.
   * `never` is the sound bottom type and satisfies every valid constraint.
   *
   * How: callers provide their profile's already-normalized parameter order;
   * this shared printer preserves Haxe constraints and owns the identical
   * spelling used by classic `.d.ts` and genes-ts source output. Constructor
   * function signatures remain separate because their local parameters are
   * inferred from call arguments rather than defaulted.
   */
  public static function emitEnumConstructorTypeParams(writer: TypeWriter,
      enumParams: Array<Type>, constructorParams: Array<Type>) {
    if (enumParams.length == 0 && constructorParams.length == 0)
      return;
    final write = writer.write;
    write('<');
    var first = true;
    function emitOne(param: Type, defaultNever: Bool) {
      if (!first)
        write(', ');
      first = false;
      switch param {
        case TInst(_.get() => {kind: KTypeParameter(constraints)}, _):
          emitType(writer, param);
          if (constraints.length > 0) {
            write(' extends ');
            for (constraint in join(constraints, write.bind(' & ')))
              emitType(writer, constraint);
          }
        default:
          emitType(writer, param);
      }
      if (defaultNever)
        write(' = never');
    }
    for (param in enumParams)
      emitOne(param, false);
    for (param in constructorParams)
      emitOne(param, true);
    write('>');
  }

  public static function emitType(writer: TypeWriter, type: Type,
      wrap = true) {
    final write = writer.write, emitPos = writer.emitPos,
    includeType = writer.includeType;
    switch type {
      case TInst(_.get() => {name: "RegroupStatus" | "RegroupResult", pos: pos}, _):
        emitPos(pos);
        write('any');
      case TType(_.get() => {name: "RegroupStatus" | "RegroupResult", pos: pos}, _):
        emitPos(pos);
        write('any');
      case TInst(ref = _.get() => cl, params)
        if (ExternTypeContract.usesImportedInstanceType(cl)):
        // The semantic classifier owns when this projection is valid. The type
        // printer owns only TypeScript spelling and uses the resolved accessor
        // so collision aliases stay consistent with constructor expressions.
        ExternTypeContract.validateImportedInstanceType(cl, params);
        includeType(TInst(ref, params));
        emitPos(cl.pos);
        write('InstanceType<typeof ');
        write(writer.typeAccessor(cl));
        write('>');
      case TInst(_.get().meta => meta, params)
        if (meta.has(':ts.type') || meta.has(':genes.type')):
        final tsOverride = switch meta.extract(':ts.type') {
          case [{params: [{expr: EConst(CString(type))}]}]: type;
          default: null;
        }
        final genesOverride = switch meta.extract(':genes.type') {
          case [{params: [{expr: EConst(CString(type))}]}]: type;
          default: null;
        }
        switch tsOverride != null ? tsOverride : genesOverride {
          case null:
            throw '@:ts.type/@:genes.type needs an expression';
          case v:
            emitTypeOverride(writer, v, params);
        }
      case TInst(ref = _.get() => cl, params):
        switch [cl, params] {
          case [{module: "js.node.Fs", name: "FsPath"}, _]:
            // hxnodejs `FsPath` maps to Node's `fs.PathLike`.
            emitPos(cl.pos);
            write('import("node:fs").PathLike');
          case [{name: name}, _] if (name.indexOf('<') > -1):
            // Haxe sometimes produces synthetic/monomorphized core types like
            // `Class<foo.Bar>` as a base type name. These don't map cleanly to
            // TS imports and are only used for type positions, so we fall back
            // to `any` for now.
            emitPos(cl.pos);
            write('any');
          case [{name: "RegroupStatus" | "RegroupResult"}, _]:
            // Some libraries reference internal helper types in public signatures, but those
            // helpers may be stripped by DCE in runtime output. Fall back to `any`.
            emitPos(cl.pos);
            write('any');
          case [{name: name, kind: KTypeParameter(_)}, _]:
            emitPos(cl.pos);
            write(name);
          case [{module: module}, _] if (module != null && module.startsWith('haxe.macro')):
            // Macro API types are not available at runtime and are often
            // stripped by DCE; emit `any` so TS can type-check runtime output.
            emitPos(cl.pos);
            write('any');
          case [{meta: meta}, _] if (switch meta.extract(':jsRequire') {
            case [{
              params: [
                {expr: EConst(CString("buffer"))},
                {expr: EConst(CString("Buffer"))}
              ]
            }]:
              true;
            default:
              false;
          }):
            // Node's `buffer` module exports a value `Buffer` in older @types/node
            // versions; use the global `Buffer` type for compatibility.
            emitPos(cl.pos);
            write('globalThis.Buffer');
          case [{meta: meta}, _] if (switch meta.extract(':native') {
            case [{params: [{expr: EConst(CString("RegExp"))}]}]: true;
            default: false;
          }):
            emitPos(cl.pos);
            write('(RegExp & { m?: RegExpExecArray | null; s?: string })');
          case [{name: "RegExpMatch"}, _]:
            // Haxe std uses `RegExpMatch` for `RegExp#exec` results.
            // Map to the TS builtin.
            emitPos(cl.pos);
            write('RegExpExecArray | null');
          case [{pack: [], name: 'String'}, _]:
            emitPos(cl.pos);
            write('string');
          case [{module: "js.lib.Symbol", name: "Symbol"}, _]:
            emitPos(cl.pos);
            write('symbol');
          case [{module: "js.lib.Set", name: "Set"}, [elemT]]:
            emitPos(cl.pos);
            write('globalThis.Set<');
            emitType(writer, elemT);
            write('>');
          case [{module: "js.lib.Map", name: "Map"}, [keyT, valueT]]:
            emitPos(cl.pos);
            write('globalThis.Map<');
            emitType(writer, keyT);
            write(', ');
            emitType(writer, valueT);
            write('>');
          case [{module: "js.lib.Promise", name: "Promise"}, [elemT]]:
            emitPos(cl.pos);
            write('Promise<');
            emitType(writer, elemT);
            write('>');
          case [{module: "js.lib.Promise", name: "Promise"}, []]:
            emitPos(cl.pos);
            write('Promise<any>');
          case [{module: "js.lib.Iterator", name: "Iterator"}, [elemT]]:
            emitPos(cl.pos);
            write('IterableIterator<');
            emitType(writer, elemT);
            write('>');
          case [{module: "js.lib.Iterator", name: "AsyncIterator"}, [elemT]]:
            emitPos(cl.pos);
            write('AsyncIterator<');
            emitType(writer, elemT);
            write('>');
          case [{pack: [], name: "Array"}, [elemT]]:
            emitPos(cl.pos);
            if (arrayElementNeedsParens(elemT)) {
              write('(');
              emitType(writer, elemT);
              write(')');
            } else
              emitType(writer, elemT);
            write('[]');
          default:
            includeType(TInst(ref, params));
            emitBaseType(writer, cl, params);
        }
      case TAbstract(_.get().meta => meta, params)
        if (meta.has(':ts.type') || meta.has(':genes.type')):
        final tsOverride = switch meta.extract(':ts.type') {
          case [{params: [{expr: EConst(CString(type))}]}]: type;
          default: null;
        }
        final genesOverride = switch meta.extract(':genes.type') {
          case [{params: [{expr: EConst(CString(type))}]}]: type;
          default: null;
        }
        switch tsOverride != null ? tsOverride : genesOverride {
          case null:
            throw '@:ts.type/@:genes.type needs an expression';
          case v:
            emitTypeOverride(writer, v, params);
        }
      case TAbstract(_.get() => ab, params):
        if (Context.defined('genes.ts')) {
          // genes-ts: treat `@:enum abstract` as a TS literal union when values
          // are known (e.g. DOM enums like `RequestCache`).
          final values = enumAbstractLiteralUnion(ab);
          if (values != null) {
            emitPos(ab.pos);
            for (v in join(values, write.bind(' | ')))
              write(v);
            return;
          }
          // DCE may remove the abstract implementation fields that carry enum
          // values before target emission. SignatureCache freezes the ordinary
          // literal spelling after typing, while those declarations still
          // exist, so a recursively recovered source type can remain closed at
          // any depth without a target assertion or a second type printer.
          final cachedEnumType = emittingCapturedSourceType
            ? genes.ts.SignatureCache.getEnumAbstractTsType(ab)
            : null;
          if (cachedEnumType != null) {
            emitPos(ab.pos);
            write(cachedEnumType);
            return;
          }
        }
        switch [ab, params] {
          case [{module: "js.lib.Symbol", name: "Symbol"}, _]:
            emitPos(ab.pos);
            write('symbol');
          case [{name: "RegroupStatus" | "RegroupResult"}, _]:
            emitPos(ab.pos);
            write('any');
          case [{pack: [], name: "Int" | "Float"}, _]:
            emitPos(ab.pos);
            write('number');
          case [{pack: [], name: "Bool"}, _]:
            emitPos(ab.pos);
            write('boolean');
          case [{pack: [], name: "Void"}, _]:
            emitPos(ab.pos);
            write('void');
          case [{pack: [], name: "Null"}, [realT]]: // Haxe 4.x
            emitPos(ab.pos);
            // genes-ts TS output profile:
            // - Default: `Null<T>` becomes `T | null` (works with strictNullChecks: true).
            // - Optional: `-D genes.ts.no_null_union` erases `Null<T>` to `T` (for
            //   strictNullChecks: false projects).
            if (Context.defined('genes.ts')
              && Context.defined('genes.ts.no_null_union')) {
              emitType(writer, realT);
            } else {
              // Both implementation TS and classic declarations expose the
              // real Haxe `Null<T>` contract. Classic Genes originally emitted
              // a nullable union; weakening it to `any` hides consumer bugs.
              final needsParens = switch realT {
                case TFun(_, _): true;
                default: false;
              }
              if (needsParens) {
                write('(');
                emitType(writer, realT);
                write(')');
              } else {
                emitType(writer, realT);
              }
              write(' | null');
            }
          case [{pack: ["haxe", "extern"] | ['haxe'], name: "Rest"}, [t]]:
            emitPos(ab.pos);
            if (arrayElementNeedsParens(t)) {
              write('(');
              emitType(writer, t);
              write(')');
            } else
              emitType(writer, t);
            write('[]');
          case [{pack: ["haxe", "extern"], name: "EitherType"}, [aT, bT]]:
            emitPos(ab.pos);
            emitType(writer, aT);
            write(' | ');
            emitType(writer, bT);
          default:
            // TODO: do we want to handle more `type Name = Underlying` cases?
            if (ab.meta.has(":coreType")) {
              emitPos(ab.pos);
              write('any');
            } else {
              emitType(writer, ab.type.applyTypeParameters(ab.params, params));
            }
        }
      case TAnonymous(_.get() => anon):
        var hasRuntimeFields = false;
        for (field in anon.fields)
          if (field.name.startsWith('__') || field.name.startsWith('_hx_')) {
            hasRuntimeFields = true;
            break;
          }
        if (hasRuntimeFields) {
          write('any');
        } else {
          write('{');
          writer.increaseIndent();
          // Fields are each emitted on their own line (see `writeNewline()` below),
          // so the field separator should not include a trailing space.
          for (field in join(anon.fields, write.bind(','))) {
            writer.writeNewline();
            emitPos(field.pos);
            if (field.doc != null)
              writer.emitComment(field.doc);
            write(TypeUtil.classFieldName(field));
            if (field.meta.has(':optional')
              || genes.ts.StdlibTypeOverrides.isOptionalAnonymousField(anon,
                field))
              write('?');
            write(': ');
            if (field.params.length > 0) {
              write('<');
              for (param in join(field.params, write.bind(', ')))
                emitType(writer, param.t);
              write('>');
            }
            // Public property syntax and value nullability are separate facts:
            // the shared contract keeps ordinary Haxe optionals nullable while
            // projecting `@:ts.optional` and optional `Undefinable<T>` fields
            // without their synthetic outer Haxe `Null` wrapper.
            final fieldNullish = NullishContract.forField(field);
            final fieldType = fieldNullish.emittedType;
            final fieldTypeOverride = typeOverrideFromMeta(field.meta);
            if (fieldTypeOverride != null) {
              emitNullishProjection(writer, fieldNullish,
                () -> emitTypeOverride(writer, fieldTypeOverride,
                  [for (param in field.params) param.t]), true);
              continue;
            }
            // Anonymous typedef fields can carry enum abstracts whose typed
            // expression form later looks like the primitive backing type. In
            // genes-ts mode, reuse the declaration-time source type and let
            // this same recursive printer handle functions, containers, and
            // nullability. The direct string cache remains the narrow fallback
            // for a singleton/top-level literal projection.
            final cachedFieldSourceType = Context.defined('genes.ts')
              ? genes.ts.SignatureCache.getAnonFieldSourceType(field.pos)
              : null;
            final cachedFieldType = Context.defined('genes.ts')
              ? genes.ts.SignatureCache.getAnonFieldTsType(field.pos)
              : null;
            emitNullishProjection(writer, fieldNullish, () -> {
              if (cachedFieldSourceType != null)
                emitCapturedSourceType(writer, cachedFieldSourceType, false);
              else if (cachedFieldType != null)
                write(cachedFieldType);
              else
                emitType(writer, fieldType, false);
            }, cachedFieldSourceType != null || cachedFieldType != null);
          }
          writer.decreaseIndent();
          writer.writeNewline();
          write('}');
        }
      case TType(_.get() => dt, params):
        switch [dt, params] {
          case [{pack: ["haxe", "extern"] | ["haxe"], name: "Rest"}, [elemT]]:
            emitPos(dt.pos);
            if (arrayElementNeedsParens(elemT)) {
              write('(');
              emitType(writer, elemT);
              write(')');
            } else
              emitType(writer, elemT);
            write('[]');
          case [{module: "js.node.Fs", name: "FsPath"}, _]:
            // hxnodejs `FsPath` maps to Node's `fs.PathLike`.
            emitPos(dt.pos);
            write('import("node:fs").PathLike');
          case [{name: "RegExpMatch"}, _]:
            // Haxe std uses `RegExpMatch` for `RegExp#exec` results.
            // Map to the TS builtin.
            emitPos(dt.pos);
            write('RegExpExecArray | null');
          case [{name: "RegroupStatus" | "RegroupResult"}, _]:
            // Some libraries reference internal helper types in public signatures, but those
            // helpers may be stripped by DCE in runtime output. Fall back to `any`.
            emitPos(dt.pos);
            write('any');
          case [{name: name}, _] if (name.indexOf('<') > -1):
            emitPos(dt.pos);
            write('any');
          case [{module: module}, _] if (module != null && module.startsWith('haxe.macro')):
            emitPos(dt.pos);
            write('any');
          case [{pack: [], name: "Null"}, [realT]]: // Haxe 3.x
            if (Context.defined('genes.ts')
              && Context.defined('genes.ts.no_null_union')) {
              emitType(writer, realT);
            } else {
              final needsParens = switch realT {
                case TFun(_, _): true;
                default: false;
              }
              if (needsParens) {
                write('(');
                emitType(writer, realT);
                write(')');
              } else {
                emitType(writer, realT);
              }
              write(' | null');
            }
          case [{module: "js.lib.Iterator", name: "Iterator"}, [elemT]]:
            emitPos(dt.pos);
            write('IterableIterator<');
            emitType(writer, elemT);
            write('>');
          case [{module: "js.lib.Iterator", name: "AsyncIterator"}, [elemT]]:
            emitPos(dt.pos);
            write('AsyncIterator<');
            emitType(writer, elemT);
            write('>');
          case [{module: "js.lib.Iterator", name: "IteratorStep"}, [elemT]]:
            emitPos(dt.pos);
            write('IteratorResult<');
            emitType(writer, elemT);
            // Haxe std defines `js.lib.IteratorStep<T>` as a simple `{ done: Bool, ?value: T }`
            // record. In TS, the equivalent and idiomatic type is the builtin `IteratorResult`
            // (a discriminated union for yield/return results).
            //
            // The shared semantic plan identifies JavaScript iterator
            // completion as `undefined`; this printer owns only TS spelling.
            final completion = NullishContract.forIteratorCompletion(elemT);
            switch completion.missingValue {
              case MissingAsUndefined:
                write(', undefined>');
              case MissingAsNull:
                write(', null>');
              case NoMissingValue:
                throw 'Iterator completion must have an explicit absence contract';
            }
          default:
            switch dt.type {
              case TInst(_.get() => {isExtern: true}, _):
                emitType(writer,
                  dt.type.applyTypeParameters(dt.params, params));
              case TAbstract(t = _.get() => {
                pack: ["haxe", "extern"],
                name: "EitherType"
              }, x) if (x.length == params.length):
                emitType(writer, TAbstract(t, params));
              default:
                includeType(type);
                emitBaseType(writer, dt, params);
            }
        }
      case TFun(args, ret):
        if (wrap)
          write('(');
        write('(');
        emitArgs(writer, args);
        write(') => ');
        emitType(writer, ret);
        if (wrap)
          write(')');
      case TDynamic(null):
        // genes-ts default is `Dynamic -> any` (pragmatic).
        // Opt-in: map to `unknown` for stricter userland (forces narrowing/casts).
        if (Context.defined('genes.ts') && Context.defined('genes.ts.dynamic_unknown'))
          write('unknown');
        else
          write('any');
      case TDynamic(elemT):
        write('{[key: string]: ');
        emitType(writer, elemT);
        write('}');
      case TEnum(ref = _.get() => et, params):
        if (et.module != null && et.module.startsWith('haxe.macro')) {
          write('any');
        } else {
          includeType(TEnum(ref, params));
          emitBaseType(writer, et, params);
        }
      default:
        write('any');
    }
  }

  static inline function isTypeParam(type: Type): Bool
    return switch type {
      case TInst(_.get() => {kind: KTypeParameter(_)}, _): true;
      default: false;
    }

  static function emitArgs(writer: TypeWriter, args: Array<{
    name: String,
    opt: Bool,
    t: Type
  }>) {
    final write = writer.write;
    // here we handle haxe's crazy argument skipping:
    // we allow trailing optional args, but if there's non-optional
    // args after the optional ones, we consider them non-optional for TS
    var noOptionalUntil = -1;
    var hadOptional = true;
    for (i in 0...args.length) {
      var arg = args[i];
      if (arg.opt) {
        hadOptional = true;
      } else if (hadOptional && !arg.opt) {
        noOptionalUntil = i;
        hadOptional = false;
      }
    }

    for (i in joinIt(0...args.length, write.bind(', '))) {
      var arg = args[i];
      if (TypeUtil.isRest(arg.t))
        write('...');
      write(if (arg.name != "") arg.name else 'arg$i');
      final nullish = NullishContract.forParameter(arg.t,
        arg.opt && i > noOptionalUntil);
      if (nullish.emitOptionalSyntax)
        write("?");
      write(': ');
      emitType(writer, nullish.emittedType);
    }
  }
}
