package genes.dts;

import genes.SourceMapGenerator;
import haxe.macro.Type;
import haxe.macro.Context;
import genes.util.IteratorUtil.*;
import genes.util.TypeUtil;

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
  public static function emitBaseType(writer: TypeWriter, type: BaseType,
      params: Array<Type>, withConstraints = false) {
    final write = writer.write, emitPos = writer.emitPos;
    emitPos(type.pos);
    final accessor = writer.typeAccessor(type);
    // Some libraries reference helper types that may be stripped by DCE in runtime output.
    // If a referenced type won't be emitted, fall back to `any` to keep TS compiling.
    if (accessor == "RegroupStatus" || accessor == "RegroupResult") {
      write("any");
      return;
    }
    write(accessor);
    emitParams(writer, params, withConstraints);
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
      case TInst(_.get().meta => meta, _)
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
            write(v);
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
            final needsParens = switch elemT {
              case TAbstract(_.get() => {pack: [], name: "Null"}, _) |
                TType(_.get() => {pack: [], name: "Null"}, _) |
                TAbstract(_.get() => {pack: ["haxe", "extern"], name: "EitherType"},
                  _):
                true;
              default: false;
            }
            if (needsParens) {
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
      case TAbstract(_.get().meta => meta, _)
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
            write(v);
        }
      case TAbstract(_.get() => ab, params):
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
            if (Context.defined('genes.ts')) {
              if (Context.defined('genes.ts.no_null_union')) {
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
            } else {
              // Classic Genes `.d.ts` mode historically used `any` here to avoid
              // strict-nullness incompatibilities for Haxe 4.x projects.
              write('any');
            }
          case [{pack: ["haxe", "extern"] | ['haxe'], name: "Rest"}, [t]]:
            emitPos(ab.pos);
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
          for (field in join(anon.fields, write.bind(', '))) {
            writer.writeNewline();
            emitPos(field.pos);
            if (field.doc != null)
              writer.emitComment(field.doc);
            write(field.name);
            if (field.meta.has(':optional'))
              write('?');
            write(': ');
            if (field.params.length > 0) {
              write('<');
              for (param in join(field.params, write.bind(', ')))
                emitType(writer, param.t);
              write('>');
            }
            emitType(writer, field.type, false);
          }
          writer.decreaseIndent();
          writer.writeNewline();
          write('}');
        }
      case TType(_.get() => dt, params):
        switch [dt, params] {
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
            if (Context.defined('genes.ts')) {
              if (Context.defined('genes.ts.no_null_union')) {
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
            } else {
              write('any');
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
            write(', any>');
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
      if (arg.opt && i > noOptionalUntil)
        write("?");
      write(': ');
      emitType(writer, arg.t);
    }
  }
}
