package genes.es;

import genes.Emitter;
import genes.Dependencies;
import genes.Module;
import genes.SourceMapGenerator.SourcePosition;
import haxe.macro.Type;
import genes.util.IteratorUtil.*;
import genes.util.TypeUtil.*;
import genes.util.Timer.timer;
import genes.JsxPlan.JsxCapabilityPolicy;
import genes.NamePlan.NamePlanProfile;
import genes.DependencyPlan.DependencyModuleRequest;

using genes.util.TypeUtil;
using Lambda;

class ModuleEmitter extends ExprEmitter {
  var emitMemberSourcePositions = true;

  /**
   * Suppresses provenance only while printing an invented compiler member.
   *
   * Why: `@:genes.compilerInternal` types have no honest source declaration
   * for consumers to navigate to, but neighboring user members must keep their
   * exact mappings. What/How: `emitModule` scopes one shared projection flag
   * around a member; every nested expression/type printer already routes
   * positions through this virtual method, so no target-specific token scan is
   * needed and the previous state is restored before the next member.
   */
  override public function emitPos(pos: SourcePosition) {
    if (emitMemberSourcePositions)
      super.emitPos(pos);
  }

  public function emitModule(module: Module, ?extension: String) {
    final projection = module.runtimeProjection;
    final dependencies = projection.bindings;
    final endTimer = timer('emitModule');
    configureLowering(module, ClassicStable);
    configureTemplateLiterals(module.templateLiteralPlan);
    ctx.typeAccessor = dependencies.typeAccessor;
    configureJsx(module.jsxPlan, JsxCapabilityPolicy.current(), dependencies);
    final typed = module.members.filter(m -> m.match(MType(_, _)));
    if (typed.length == module.members.length && module.expose.length == 0)
      return endTimer();
    emitDirectivePrologue(module);
    if (haxe.macro.Context.defined('genes.banner')) {
      write(haxe.macro.Context.definedValue('genes.banner'));
      writeNewline();
    }
    var endImportTimer = timer('emitImports');
    for (requestPlan in projection.runtimeRequests) {
      final request = requestPlan.request;
      final where = request.external ? request.path : module.toPath(request.path);
      if (requestPlan.bindings.length == 0)
        emitSideEffectImport(request, where, extension);
      else
        emitImports(where, [for (binding in requestPlan.bindings) binding],
          extension);
    }
    endImportTimer();
    if (module.module != 'genes.Register' && ctx.hasFeature('js.Lib.global')) {
      writeNewline();
      write("const $global = ");
      write(ctx.typeAccessor(registerType));
      write(".$global");
      writeNewline();
    }
    for (member in module.members) {
      final memberProjection = Module.memberProjection(member);
      if (!memberProjection.emitImplementation)
        continue;
      final previousSourcePositions = emitMemberSourcePositions;
      emitMemberSourcePositions = memberProjection.emitSourcePosition;
      switch member {
        case MClass(cl, _, fields) if (cl.isInterface):
          emitInterface(cl, memberProjection.exportImplementation);
        case MClass(cl, _, fields):
          final emittableFields = Module.emittableFields(fields);
          final endClassTimer = timer('emitClass');
          emitClass(module.isCyclic, cl, emittableFields,
            memberProjection.exportImplementation,
            memberProjection.registerRuntimeType);
          endClassTimer();
          var endStaticsTimer = timer('emitStatics');
          emitStatics(module.isCyclic, cl, emittableFields);
          endStaticsTimer();
          emitInit(cl);
        case MEnum(et, _):
          var endEnumTimer = timer('emitEnums');
          emitEnum(et, memberProjection.exportImplementation,
            memberProjection.registerRuntimeType);
          endEnumTimer();
        case MMain(e):
          writeNewline();
          emitExpr(e);
        default:
      }
      emitMemberSourcePositions = previousSourcePositions;
    }
    for (export in module.expose)
      if (!export.isType)
        emitExport(export, module.toPath(export.module), extension);
    return endTimer();
  }

  /** Emits one validated module directive plan before any other statement. */
  function emitDirectivePrologue(module: Module): Void {
    for (directive in module.directivePlan.directives) {
      emitPos(directive.pos);
      emitString(directive.value);
      write(';');
      writeNewline();
    }
  }

  function emitExport(export: ModuleExport, from: String, ?extension: String) {
    writeNewline();
    write('export {');
    write(export.name);
    write('} from ');
    #if genes.no_extension
    emitString(from);
    #else
    emitString(if (extension != null) '$from$extension' else from);
    #end
  }

  function emitImports(module: String, imports: Array<Dependency>,
      ?extension: String) {
    final named:Array<Dependency> = [];
    for (def in imports)
      switch def.type {
        case DAsterisk | DDefault:
          emitImport([def], module, extension);
        default:
          named.push(def);
      }
    for (group in Dependencies.groupByImportAttribute(named))
      emitImport(group, module, extension);
  }

  /** Prints the binding-free form of one already-ordered runtime request. */
  function emitSideEffectImport(request: DependencyModuleRequest,
      where: String, ?extension: String): Void {
    write('import');
    writeSpace();
    emitPos(request.pos);
    #if genes.no_extension
    emitString(where);
    #else
    emitString(if (!request.external && extension != null)
      '$where$extension' else where);
    #end
    if (request.importAttributeType != null) {
      write(' with { type: ');
      emitString(request.importAttributeType);
      write(' }');
    }
    writeNewline();
  }

  function emitImport(what: Array<Dependency>, where: String,
      ?extension: String) {
    write('import');
    writeSpace();
    switch what {
      case [def = {type: DependencyType.DAsterisk}]:
        emitPos(def.pos);
        write('* as ' + if (def.alias != null) def.alias else def.name);
      case [def = {type: DependencyType.DDefault}]:
        emitPos(def.pos);
        write(if (def.alias != null) def.alias else def.name);
      case defs:
        write('{');
        for (def in join(defs, write.bind(', '))) {
          emitPos(def.pos);
          write(def.name
            + if (def.alias != null && def.alias != def.name)
              ' as ${def.alias}' else '');
        }
        write('}');
    }
    writeSpace();
    write('from');
    writeSpace();
    #if genes.no_extension
    emitString(where);
    #else
    var isExternal = false;
    for (dependency in what)
      if (dependency.external) {
        isExternal = true;
        break;
      }
    emitString(if (!isExternal && extension != null) '$where$extension' else
      where);
    #end
    final importAttributeType = Dependencies.commonImportAttributeType(what);
    if (importAttributeType != null) {
      write(' with { type: ');
      emitString(importAttributeType);
      write(' }');
    }
    writeNewline();
  }

  function emitStatics(checkCycles: (module: String) -> Bool, cl: ClassType,
      fields: Array<Field>) {
    writeNewline();
    for (field in fields)
      switch field {
        case {kind: Property, isStatic: true, expr: expr} if (expr != null):
          final types = TypeUtil.typesInExpr(expr);
          final isCyclic = types.fold((type, res) -> {
            return res || checkCycles(TypeUtil.moduleTypeModule(type));
          }, false);
          if (isCyclic)
            emitDeferredStatic(cl, field);
          else
            emitStatic(cl, field);
        default:
      }

    #if (haxe_ver >= 4.2)
    if (!cl.kind.match(KModuleFields(_)))
      return;

    // Bind `@:jsRequire` module-level externs onto the module fields class.
    //
    // Haxe represents module-level functions/vars as static fields on a
    // synthetic "module fields" class. When those fields are externs backed
    // by `@:jsRequire`, they have no body, so we need to explicitly bind them
    // to the imported value for runtime correctness.
    for (field in fields)
      switch field {
        case {isStatic: true, meta: meta} if (meta != null):
          switch meta.extract(':jsRequire') {
            case [{params: [{expr: EConst(CString(_))}]}]:
              // Single-arg form imports the module; treat the field name as the
              // imported identifier.
              writeNewline();
              emitPos(field.pos);
              emitIdent(TypeUtil.className(cl));
              emitField(staticName(cl, field));
              write(' = ');
              emitIdent(field.name);
              writeNewline();
            case [{params: [{expr: EConst(CString(_))}, {expr: EConst(CString('default'))}]}]:
              writeNewline();
              emitPos(field.pos);
              emitIdent(TypeUtil.className(cl));
              emitField(staticName(cl, field));
              write(' = ');
              emitIdent(field.name);
              writeNewline();
            case [{params: [{expr: EConst(CString(_))}, {expr: EConst(CString(name))}]}]:
              writeNewline();
              emitPos(field.pos);
              emitIdent(TypeUtil.className(cl));
              emitField(staticName(cl, field));
              write(' = ');
              emitIdent(name);
              writeNewline();
            default:
          }
        default:
      }

    writeNewline();
    for (field in fields)
      switch field {
        case {isStatic: true, isPublic: true}:
          write('export const ');
          emitIdent(field.name);
          write(' = ');
          emitIdent(TypeUtil.className(cl));
          emitField(field.name);
          writeNewline();
        default:
      }
    #end
  }

  function staticName(cl: ClassType, field: Field)
    return switch TypeUtil.nativeName(field.meta) {
      case null:
        switch [cl.isExtern, field.name] {
      case [false, name = 'name' | 'length']: '$' + name;
      default: field.name;
    }
      case native:
        native;
    }

  function memberName(field: Field): String {
    final native = TypeUtil.nativeName(field.meta);
    return native != null ? native : field.name;
  }

  function emitStatic(cl: ClassType, field: Field) {
    writeNewline();
    emitPos(field.pos);
    emitIdent(TypeUtil.className(cl));
    emitField(staticName(cl, field));
    write(' = ');
    emitValue(field.expr);
  }

  function emitDeferredStatic(cl: ClassType, field: Field) {
    writeNewline();
    emitPos(field.pos);
    write(ctx.typeAccessor(registerType));
    write('.createStatic(');
    emitIdent(TypeUtil.className(cl));
    write(', ');
    emitString(staticName(cl, field));
    write(', function () { return ');
    emitValueWithExpectedType(field.type, field.expr);
    write(' })');
  }

  function emitInit(cl: ClassType) {
    if (cl.init != null) {
      writeNewline();
      write(';');
      emitPos(cl.pos);
      emitExpr(cl.init);
      writeNewline();
    }
  }

  static function hasExternSuper(s: ClassType)
    return switch s.superClass {
      case null: s.isExtern;
      case {t: _.get() => v}: hasExternSuper(v);
    }

  static function hasConstructor(fields: Array<Field>) {
    for (field in fields)
      if (field.kind.equals(Constructor))
        return true;
    return false;
  }

  function emitInterface(cl: ClassType, export = true) {
    writeNewline();
    if (export)
      write('export ');
    write('const ');
    write(TypeUtil.className(cl));
    write(' = function() {};');
    writeNewline();
    write(TypeUtil.className(cl));
    write('.__isInterface__ = true;');
    writeNewline();
  }

  function emitClass(checkCycles: (module: String) -> Bool, cl: ClassType,
      fields: Array<Field>, export = true, registerRuntimeType = true) {
    writeNewline();
    emitComment(cl.doc);
    emitPos(cl.pos);
    if (export)
      write('export ');

    final id = cl.pack.concat([TypeUtil.className(cl)]).join('.');
    if (id != 'genes.Register') {
      write('const ');
      write(TypeUtil.className(cl));
      write(' = ');
      if (registerRuntimeType) {
        writeGlobalVar("$hxClasses");
        write('[');
        emitString(id);
        write(']');
        // The class expression starts on the next line. Keep the operator but
        // do not leave an invisible trailing space in the generated module.
        write(' =');
        writeNewline();
      }
    }

    emitPos(cl.pos);
    write('class ');
    write(TypeUtil.className(cl));
    if (cl.superClass != null || hasConstructor(fields)) {
      write(' extends ');
      write(ctx.typeAccessor(registerType));
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
    for (field in fields)
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
              final isAsync = field.meta != null && (field.meta.has(':jsAsync') || field.meta.has('jsAsync'));
              if (field.isStatic) {
                write('static ');
                if (isAsync)
                  write('async ');
                write(staticName(cl, field));
              } else if (field.kind.equals(Constructor)) {
                write('[');
                write(ctx.typeAccessor(registerType));
                write('.new]');
              } else {
                if (isAsync)
                  write('async ');
                write(memberName(field));
              }
              write('(');
              emitFunctionArguments(f);
              write(') ');
              emitFunctionBody(f);
            default:
          }
        case Property:
          if (field.getter) {
            writeNewline();
            emitPos(field.pos);
            if (field.isStatic)
              write('static ');
            write('get ');
            write(memberName(field));
            write('() {');
            increaseIndent();
            writeNewline();
            write('return this.get_');
            write(field.name);
            write('()');
            decreaseIndent();
            writeNewline();
            write('}');
          }
          if (field.setter) {
            writeNewline();
            emitPos(field.pos);
            if (field.isStatic)
              write('static ');
            write('set ');
            write(memberName(field));
            write('(v) {');
            increaseIndent();
            writeNewline();
            write('this.set_');
            write(field.name);
            write('(v)');
            decreaseIndent();
            writeNewline();
            write('}');
          }
        default:
      }
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

    for (field in fields)
      switch field.kind {
        case Property:
          if (!field.getter && !field.setter && !field.isStatic) {
            writeNewline();
            emitIdent(TypeUtil.className(cl));
            write('.prototype.');
            emitPos(field.pos);
            write(memberName(field));
            write(' = null;');
          }
        default:
      }

    if (export)
      writeNewline();
  }

  function emitEnum(et: EnumType, export = true,
      registerRuntimeType = true) {
    final discriminator = haxe.macro.Context.definedValue('genes.enum_discriminator');
    final id = et.pack.concat([et.name]).join('.');
    writeNewline();
    emitComment(et.doc);
    emitPos(et.pos);
    if (export)
      write('export ');
    write('const ');
    write(et.name);
    // Registered enums continue on the next line; unregistered private enums
    // still keep the conventional inline space before their object literal.
    write(registerRuntimeType ? ' =' : ' = ');
    if (registerRuntimeType) {
      writeNewline();
      writeGlobalVar("$hxEnums");
      write('[');
      emitString(id);
      write(']');
      write(' =');
      writeNewline();
    }
    write('{');
    increaseIndent();
    writeNewline();
    if (ctx.hasFeature('js.Boot.isEnum')) {
      write('__ename__: "${id}",');
      writeNewline();
    }
    writeNewline();
    for (name in join(et.names, () -> {
      write(',');
      writeNewline();
    })) {
      final c = et.constructs.get(name);
      emitComment(c.doc);
      emitPos(c.pos);
      write(name);
      write(': ');
      switch c.type {
        case TFun(args, ret):
          write('Object.assign((');
          for (param in join(args, write.bind(', ')))
            emitLocalIdent(param.name);
          write(') => ({_hx_index: ${c.index}, __enum__: "${id}", ');
          for (param in join(args, write.bind(', '))) {
            emitString(param.name);
            write(': ');
            emitLocalIdent(param.name);
          }
          if (discriminator != null) {
            write(', ');
            emitString(discriminator);
            write(': ');
            emitString(name);
          }
          write('}), {_hx_name: "${name}", __params__: [');
          for (param in join(args, write.bind(', ')))
            emitString(param.name);
          write(']})');
        default:
          write('{_hx_name: "${name}", _hx_index: ${c.index}, __enum__: "${id}"');
          if (discriminator != null) {
            write(', ');
            emitString(discriminator);
            write(': ');
            emitString(name);
          }
          write('}');
      }
    }
    decreaseIndent();
    writeNewline();
    write('}');
    writeNewline();

    write(et.name);
    write('.__constructs__ = [');
    for (c in join(et.names, write.bind(', '))) {
      #if (haxe_ver >= 4.2)
      write(et.name);
      emitField(c);
      #else
      emitString(c);
      #end
    }
    write(']');
    writeNewline();

    write(et.name);
    write('.__empty_constructs__ = [');
    final empty = [
      for (name in et.names)
        if (!et.constructs[name].type.match(TFun(_, _))) et.constructs[name]
    ];
    for (c in join(empty, write.bind(', '))) {
      write(et.name);
      emitField(c.name);
    }
    write(']');
    writeNewline();
  }
}
