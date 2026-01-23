package genes.ts;

import genes.Dependencies;
import genes.Module;
import genes.TypeAccessor;
import genes.Module.Field as GenesField;
import genes.Module.FieldKind;
import genes.es.ModuleEmitter as JsModuleEmitter;
import genes.dts.TypeEmitter;
import genes.util.Timer.timer;
import genes.util.TypeUtil;
import haxe.ds.Option;
import haxe.macro.Expr;
import haxe.macro.Type;
import genes.util.IteratorUtil.*;

using genes.util.TypeUtil;
using Lambda;
using haxe.macro.Tools;

/**
 * Minimal TS module emitter (M1):
 * - Emits `.ts` modules with ESM imports/exports
 * - Emits `export class` declarations (not `export const Foo = class Foo`)
 * - Adds enough type annotations for `tsc --noEmit` under `strict`
 *
 * This is intentionally incomplete. Expression coverage and richer typing land in later milestones.
 */
class TsModuleEmitter extends JsModuleEmitter {
  public function emitTsModule(module: Module, importExtension: Null<String>) {
    final endTimer = timer('emitTsModule');

    // Merge code + type dependencies so TS signatures can resolve.
    final deps = new Dependencies(module, true);
    mergeDepsInto(deps, module.codeDependencies);
    mergeDepsInto(deps, module.typeDependencies);
    ctx.typeAccessor = deps.typeAccessor;

    final typedOnly = module.members.filter(m -> m.match(MType(_, _)));
    if (typedOnly.length == module.members.length && module.expose.length == 0)
      return endTimer();

    if (haxe.macro.Context.defined('genes.banner')) {
      write(haxe.macro.Context.definedValue('genes.banner'));
      writeNewline();
    }

    final endImportTimer = timer('emitImports');
    for (path => imports in deps.imports) {
      emitImports(if (imports[0].external) path else module.toPath(path),
        imports, importExtension);
    }
    endImportTimer();

    // Keep Genes behavior for js.Lib.global feature.
    if (module.module != 'genes.Register' && ctx.hasFeature('js.Lib.global')) {
      writeNewline();
      write("const $global = ");
      write(ctx.typeAccessor(TypeUtil.registerType));
      write(".$global");
      writeNewline();
    }

    for (member in module.members) {
      switch member {
        case MClass(cl, _, fields) if (cl.isInterface):
          // TODO(genes-ts): Emit `export interface` + runtime stub merge.
          emitInterface(cl);
        case MClass(cl, _, fields):
          final endClassTimer = timer('emitClass');
          emitTsClass(module.isCyclic, cl, fields);
          endClassTimer();
          final endStaticsTimer = timer('emitStatics');
          emitTsStatics(module.isCyclic, cl, fields);
          endStaticsTimer();
          emitInit(cl);
        case MEnum(et, _):
          final endEnumTimer = timer('emitEnums');
          emitEnum(et);
          endEnumTimer();
        case MMain(e):
          writeNewline();
          emitExpr(e);
        default:
      }
    }

    for (export in module.expose)
      if (!export.isType)
        emitExport(export, module.toPath(export.module), importExtension);

    return endTimer();
  }

  static function mergeDepsInto(into: Dependencies, from: Dependencies) {
    for (path => imports in from.imports) {
      for (dep in imports) {
        into.push(path, {
          type: dep.type,
          name: dep.name,
          external: dep.external,
          path: dep.path,
          alias: dep.alias,
          pos: dep.pos
        });
      }
    }
  }

  function emitTsStatics(checkCycles: (module: String) -> Bool, cl: ClassType,
      fields: Array<GenesField>) {
    // Emit typed declarations inside the class (for TS), then reuse JS emitter's
    // static initialization logic outside the class.
    //
    // NOTE: This is intentionally conservative to avoid semantic changes.
    // We only declare static fields here; actual initialization remains outside.

    // No-op for now: declarations are emitted in emitTsClass.
    super.emitStatics(checkCycles, cl, fields);
  }

  function emitTsClass(checkCycles: (module: String) -> Bool, cl: ClassType,
      fields: Array<GenesField>) {
    writeNewline();
    emitComment(cl.doc);
    emitPos(cl.pos);
    write('export class ');
    write(TypeUtil.className(cl));
    if (cl.params != null && cl.params.length > 0)
      TypeEmitter.emitParams(this, cl.params.map(p -> p.t), true);

    final extendsInherits = cl.superClass != null
      || JsModuleEmitter.hasConstructor(fields);
    if (extendsInherits) {
      write(' extends ');
      write(ctx.typeAccessor(TypeUtil.registerType));
      write('.inherits(');
      switch cl.superClass {
        case null:
        case {t: TClassDecl(_) => t}:
          final isCyclic = checkCycles(TypeUtil.moduleTypeModule(t));
          if (isCyclic)
            write('() => ');
          write(ctx.typeAccessor(t));
          if (isCyclic)
            write(', true');
      }
      write(')');
    }

    extendsExtern = switch cl.superClass {
      case null: None;
      case {t: t = _.get() => {isExtern: true}}:
        Some(cl.superClass.t.get());
      default: None;
    }

    write(' {');
    increaseIndent();

    // Explicit ctor signatures (TS) matching Haxe `new`.
    // Runtime behavior is unchanged: the implementation forwards to `super(...args)`.
    if (extendsInherits) {
      final ctorField = fields.find(f -> f.kind.equals(Constructor));
      writeNewline();
      if (ctorField != null)
        emitPos(ctorField.pos);
      write('constructor(');
      if (ctorField != null)
        switch ctorField.expr {
          case {expr: TFunction(f)}:
            emitTypedFunctionArguments(f, ctorField);
          default:
        }
      write(');');

      writeNewline();
      write('constructor(...args: any[]) {');
      increaseIndent();
      writeNewline();
      write('super(...args);');
      decreaseIndent();
      writeNewline();
      write('}');
    }

    // Emit typed property declarations so TS code can type-check under `strict`.
    for (field in fields) {
      switch field.kind {
        case Property:
          // Skip native accessors for now (handled by JS emitter behavior).
          // Still declare the property name as a field so TS knows it exists.
          writeNewline();
          emitPos(field.pos);
          if (!field.isStatic && !field.isPublic)
            write('protected ');
          if (field.isStatic)
            write('static ');
          emitMemberName(field.isStatic ? staticName(cl, field) : field.name);
          write(': ');
          emitFieldTsType(field);
          write(' = null as any;');
        default:
      }
    }

    // Emit methods/ctors with typed args/returns.
    for (field in fields) {
      switch field.kind {
        case Constructor | Method
          #if (haxe_ver >= 4.2) if (!field.isAbstract) #end:
          switch field.expr {
            case null:
            case {expr: TFunction(f)}:
              writeNewline();
              if (field.doc != null)
                writeNewline();
              emitComment(field.doc);
              emitPos(field.pos);
              if (field.isStatic) {
                write('static ');
                emitMemberName(staticName(cl, field));
              } else if (field.kind.equals(Constructor)) {
                write('[');
                write(ctx.typeAccessor(TypeUtil.registerType));
                write('.new]');
              } else {
                emitMemberName(field.name);
              }

              emitMethodTypeParams(field);
              write('(');
              emitTypedFunctionArguments(f, field);
              write(')');

              // Return type
              if (field.kind.equals(Constructor)) {
                write(': void ');
              } else {
                write(': ');
                emitReturnTsType(field, f);
                write(' ');
              }

              emitExpr(getFunctionBody(f));
            default:
          }
        default:
      }
    }

    // Keep Genes runtime identity helpers.
    writeNewline();
    write('static get __name__() {');
    increaseIndent();
    writeNewline();
    write('return ');
    emitString(cl.pack.concat([cl.name]).join('.'));
    decreaseIndent();
    writeNewline();
    write('}');

    switch cl.interfaces {
      case []:
      case v:
        writeNewline();
        write('static get __interfaces__() {');
        increaseIndent();
        writeNewline();
        write('return [');
        for (i in join(v, write.bind(', ')))
          write(ctx.typeAccessor(i.t.get()));
        write(']');
        decreaseIndent();
        writeNewline();
        write('}');
    }

    switch cl.superClass {
      case null:
      case {t: TClassDecl(_) => t}:
        writeNewline();
        write('static get __super__() {');
        increaseIndent();
        writeNewline();
        write('return ');
        write(ctx.typeAccessor(t));
        decreaseIndent();
        writeNewline();
        write('}');
    }

    writeNewline();
    write('get __class__() {');
    increaseIndent();
    writeNewline();
    write('return ');
    emitIdent(TypeUtil.className(cl));
    decreaseIndent();
    writeNewline();
    write('}');

    decreaseIndent();
    writeNewline();
    write('}');

    // Register class in $hxClasses registry (Genes runtime compatibility).
    final id = cl.pack.concat([TypeUtil.className(cl)]).join('.');
    if (id != 'genes.Register') {
      writeNewline();
      write('(');
      writeGlobalVar("$hxClasses");
      write(' as any)[');
      emitString(id);
      write('] = ');
      emitIdent(TypeUtil.className(cl));
      write(';');
      writeNewline();
    }
  }

  function emitMethodTypeParams(field: GenesField) {
    if (field.params == null || field.params.length == 0)
      return;
    TypeEmitter.emitParams(this, field.params.map(p -> p.t), true);
  }

  override public function emitVar(v: TVar, eo: Null<TypedExpr>) {
    write('$declare ');
    emitLocalIdent(v.name);
    write(': ');
    TypeEmitter.emitType(this, v.t);
    switch (eo) {
      case null:
      case {expr: TConst(TNull)}:
        write(' = null as any');
      case e:
        write(' = ');
        emitValue(e);
    }
  }

  function emitTypedFunctionArguments(f: TFunc, field: GenesField) {
    switch field.type {
      case TFun(args, _):
        // Handle Haxe optional argument skipping semantics (same as TypeEmitter.emitArgs).
        var noOptionalUntil = -1;
        var hadOptional = true;
        for (i in 0...args.length) {
          final arg = args[i];
          if (arg.opt) {
            hadOptional = true;
          } else if (hadOptional && !arg.opt) {
            noOptionalUntil = i;
            hadOptional = false;
          }
        }

        for (i in genes.util.IteratorUtil.joinIt(0...args.length,
          write.bind(', '))) {
          final arg = args[i];
          if (genes.util.TypeUtil.isRest(arg.t))
            write('...');
          emitLocalIdent(arg.name);
          if (arg.opt && i > noOptionalUntil)
            write('?');
          write(': ');
          emitArgTsType(field, f, i, arg.t);
        }
      default:
        // Fallback: keep old behavior.
        emitFunctionArguments(f);
    }
  }

  function emitArgTsType(field: GenesField, f: TFunc, index: Int,
      type: Type) {
    // Param-level override (preferred): @:ts.type / @:genes.type on the argument var meta.
    final argMeta = f.args[index].v.meta;
    final typeOverride = switch argMeta.extract(':ts.type') {
      case [{params: [{expr: EConst(CString(typeOverride))}]}]:
        typeOverride;
      default:
        switch argMeta.extract(':genes.type') {
          case [{params: [{expr: EConst(CString(typeOverride))}]}]:
            typeOverride;
          default:
            null;
        }
    };
    if (typeOverride != null) {
      write(typeOverride);
      return;
    }
    emitType(type);
  }

  function emitReturnTsType(field: GenesField, f: TFunc) {
    final returnOverride = field.meta != null ? (switch extractStringMeta(field.meta,
      ':ts.returnType') {
      case null: extractStringMeta(field.meta, ':genes.returnType');
      case v: v;
    }) : null;
    if (returnOverride != null) {
      write(returnOverride);
      return;
    }
    switch field.type {
      case TFun(_, ret):
        emitType(ret);
      default:
        write('any');
    }
  }

  function emitFieldTsType(field: GenesField) {
    if (field.tsType != null) {
      write(field.tsType);
      return;
    }
    emitType(field.type, field.isStatic ? null : field.params);
  }

  public function includeType(type: Type) {}

  public function typeAccessor(type: TypeAccessor)
    return ctx.typeAccessor(type);

  function emitType(type: Type, ?params: Array<TypeParameter>) {
    if (params != null && params.length > 0)
      TypeEmitter.emitParams(this, params.map(p -> p.t), true);
    TypeEmitter.emitType(this, type, params == null);
  }

  static function extractStringMeta(meta: Null<MetaAccess>,
      name: String): Null<String> {
    if (meta == null)
      return null;
    return switch meta.extract(name) {
      case [{params: [{expr: EConst(CString(value))}]}]: value;
      default: null;
    }
  }
}
