package genes;

import haxe.macro.Context;
import haxe.macro.Type;
import haxe.macro.Expr;
import helder.Set;
import genes.util.TypeUtil;
import genes.Dependencies;
import genes.util.TypeUtil;
import genes.dts.TypeEmitter;
import genes.util.Timer.timer;
import genes.TypeAccessor;
import genes.PublicSurface.PublicMember;

using StringTools;
using haxe.macro.TypedExprTools;

enum FieldKind {
  Constructor;
  Method;
  Property;
}

typedef Field = {
  final kind: FieldKind;
  final meta: Null<MetaAccess>;
  final name: String;
  final type: Type;
  final expr: TypedExpr;
  final pos: Position;
  final isStatic: Bool;
  #if (haxe_ver >= 4.2)
  final isAbstract: Bool;
  #end
  final isPublic: Bool;
  final params: Array<TypeParameter>;
  final doc: Null<String>;
  final setter: Bool;
  final getter: Bool;
  final tsType: Null<String>;
  final overloads: Array<Field>;
}

enum Member {
  MClass(type: ClassType, params: Array<Type>, fields: Array<Field>);
  MEnum(type: EnumType, params: Array<Type>);
  MType(type: DefType, params: Array<Type>);
  MMain(expr: TypedExpr);
}

typedef ModuleContext = {
  modules: Map<String, Module>,
  concrete: Array<String>
}

typedef ModuleExport = {
  pos: Position,
  name: String,
  module: String,
  isType: Bool
}

class Module {
  public final module: String;
  public final path: String;
  public final members: Array<Member> = [];
  public final expose: Array<ModuleExport> = [];
  public var typeDependencies(get, null): Dependencies;
  public var codeDependencies(get, null): Dependencies;

  final context: ModuleContext;
  final cycleCache = new Map<String, Bool>();

  public function new(context: ModuleContext, module, types: Array<Type>,
      ?main: TypedExpr, ?expose: Array<ModuleExport>) {
    this.context = context;
    this.module = module;
    if (expose != null)
      this.expose = expose;
    path = module.split('.').join('/');
    final endTimer = timer('members');
    for (type in types)
      switch type {
        case TEnum(_.get() => et, params):
          members.push(MEnum(et, params));
        case TInst(_.get() => cl, params):
          members.push(MClass(cl, params, fieldsOf(cl)));
        case TType(_.get() => tt, params):
          function addIfConcrete(t: BaseType) {
            final name = TypeUtil.baseTypeFullName(t);
            if (context.concrete.indexOf(name) > -1)
              members.push(MType(tt, params));
          }
          switch Context.followWithAbstracts(tt.type) {
            case TEnum(_.get() => t, _): addIfConcrete(t);
            case TInst(t = _.get() => {
              kind: KNormal
              #if (haxe_ver >= 4.2)
              | KModuleFields(_)
              #end
              | KGeneric | KGenericInstance(_, _) | KAbstractImpl(_)
            }, _):
              addIfConcrete(t.get());
            default: members.push(MType(tt, params));
          }
        default:
          throw 'assert';
      }
    if (main != null)
      members.push(MMain(main));
    endTimer();
  }

  public function toPath(from: String) {
    return genes.util.PathUtil.relative(path, from.replace('.', '/'));
  }

  public function isCyclic(test: String)
    return switch cycleCache.get(test) {
      case null:
        final endTimer = timer('isCyclic');
        final seen = new Set();
        seen.add(module);
        final res = testCycles(test, seen);
        cycleCache.set(test, res);
        endTimer();
        res;
      case v: v;
    }

  function testCycles(test: String, seen: Set<String>) {
    seen.add(test);
    switch context.modules[test] {
      case null:
        return false;
      case v:
        for (dependency in v.codeDependencies.imports.keys()) {
          if (seen.exists(dependency)) {
            if (dependency == module)
              return true;
            else
              continue;
          }
          if (testCycles(dependency, seen))
            return true;
        }
        return false;
    }
  }

  function get_typeDependencies() {
    if (typeDependencies != null)
      return typeDependencies;
    final endTimer = timer('typeDependencies');
    final dependencies = new Dependencies(this, false);
    final tsMode = Context.defined('genes.ts');
    final declarationMode = Context.defined('dts');
    final noop = function() {}
    final writer = {
      write: function(code: String) {},
      writeNewline: noop,
      increaseIndent: noop,
      decreaseIndent: noop,
      emitComment: function(comment: String) {},
      emitPos: function(pos) {},
      includeType: function(type: Type) {
        dependencies.add(TypeUtil.typeToModuleType(type));
      },
      typeAccessor: dependencies.typeAccessor
    }
    function addBaseType(type: BaseType, params: Array<Type>)
      TypeEmitter.emitBaseType(writer, type, params, true);
    function addType(type: Type)
      TypeEmitter.emitType(writer, type);
    function addParams(params: Array<Type>)
      TypeEmitter.emitParams(writer, params, true);
    function addExprLocalTypes(e: TypedExpr) {
      if (e == null)
        return;
      switch e.expr {
        case TVar(v, _):
          addType(v.t);
        case TFunction(f):
          for (arg in f.args)
            addType(arg.v.t);
        default:
      }
      e.iter(addExprLocalTypes);
    }
    for (member in members) {
      switch member {
        case MClass(cl, params, fields):
          addParams(params);
          final publicSurface = (tsMode || declarationMode)
            ? PublicSurface.forClass(cl)
            : null;
          final publicInterfaces = publicSurface == null
            ? [for (parent in cl.interfaces)
                new genes.PublicSurface.PublicTypeUse(parent.t, parent.params)]
            : publicSurface.interfacesFor(params);
          switch publicInterfaces {
            case null | []:
            case v:
              for (i in v) {
                dependencies.add(TClassDecl(i.type));
                addBaseType(i.type.get(), i.copyArguments());
              }
          }
          final publicSuperClass = publicSurface == null
            ? (switch cl.superClass {
                case null: null;
                case parent: new genes.PublicSurface.PublicTypeUse(parent.t,
                  parent.params);
              })
            : publicSurface.superClassFor(params);
          switch publicSuperClass {
            case null:
            case parent:
              dependencies.add(TClassDecl(parent.type));
              addBaseType(parent.type.get(), parent.copyArguments());
          }
          // Dependency discovery consumes exactly the same source-level API
          // facts as declaration-like emitters. Interfaces use their complete
          // surface. Class declarations currently intersect it with runtime
          // reachability until DependencyPlan can retain declaration-only type
          // edges without pulling implementation modules into classic JS.
          final signatureFields = publicSurface != null
            && (declarationMode || cl.isInterface)
            ? fieldsOf(cl, publicSurface, params, tsMode && cl.isInterface,
              declarationMode && !cl.isInterface ? fields : null)
            : fields;
          function addSignatureField(field: Field): Void {
            if (field.tsType != null)
              return;
            addParams(field.params.map(parameter -> parameter.t));
            addType(field.type);
            for (signature in field.overloads)
              addSignatureField(signature);
          }
          for (field in signatureFields)
            addSignatureField(field);
          if (tsMode) {
            for (field in fields)
              addExprLocalTypes(field.expr);
            addExprLocalTypes(cl.init);
          }
        case MEnum(et, params):
          addParams(params);
          for (c in et.constructs) {
            addParams(c.params.map(p -> p.t));
            switch c.type {
              case TFun(args, ret):
                for (arg in args) {
                  addType(arg.t);
                }
              default:
            }
          }
        case MMain(expr):
          addType(expr.t);
          if (tsMode)
            addExprLocalTypes(expr);
        case MType(def, params):
          addParams(params);
          addType(def.type);
        default:
      }
    }
    endTimer();
    return typeDependencies = dependencies;
  }

  function get_codeDependencies() {
    if (codeDependencies != null)
      return codeDependencies;
    final endTimer = timer('codeDependencies');
    final dependencies = new Dependencies(this);
    #if (haxe_ver >= 4.2)
    function addModuleFieldRequires(cl: ClassType, fields: Array<Field>) {
      if (!cl.kind.match(KModuleFields(_)))
        return;
      for (field in fields) {
        if (!field.isStatic || field.meta == null)
          continue;
        switch field.meta.extract(':jsRequire') {
          case [{params: [{expr: EConst(CString(path))}]}]:
            // Mirror Dependencies.makeDependency behavior for types:
            // single-arg jsRequire implies default import (or wildcard import, but
            // fields can't be wildcard-imported reliably).
            dependencies.push(path, {
              type: DependencyType.DDefault,
              name: field.name,
              path: path,
              external: true,
              importAttributeType: Dependencies.extractImportAttributeType(field.meta),
              pos: field.pos
            });
          case [{params: [{expr: EConst(CString(path))}, {expr: EConst(CString('default'))}]}]:
            dependencies.push(path, {
              type: DependencyType.DDefault,
              name: field.name,
              path: path,
              external: true,
              importAttributeType: Dependencies.extractImportAttributeType(field.meta),
              pos: field.pos
            });
          case [{params: [{expr: EConst(CString(path))}, {expr: EConst(CString(name))}]}]:
            dependencies.push(path, {
              type: DependencyType.DName,
              name: name,
              path: path,
              external: true,
              importAttributeType: Dependencies.extractImportAttributeType(field.meta),
              pos: field.pos
            });
          default:
        }
      }
    }
    #end
    function addJsRequireFromExpr(e: TypedExpr) {
      if (e == null)
        return;
      switch e.expr {
        case TField(_,
          FStatic(_, _.get() => field)):
          switch field.meta.extract(':jsRequire') {
            case [{params: [{expr: EConst(CString(path))}]}]:
              dependencies.push(path, {
                type: DependencyType.DDefault,
                name: field.name,
                path: path,
                external: true,
                importAttributeType: Dependencies.extractImportAttributeType(field.meta),
                pos: field.pos
              });
            case [{
              params: [
                {expr: EConst(CString(path))},
                {expr: EConst(CString('default'))}
              ]
            }]:
              dependencies.push(path, {
                type: DependencyType.DDefault,
                name: field.name,
                path: path,
                external: true,
                importAttributeType: Dependencies.extractImportAttributeType(field.meta),
                pos: field.pos
              });
            case [{
              params: [
                {expr: EConst(CString(path))},
                {expr: EConst(CString(name))}
              ]
            }]:
              dependencies.push(path, {
                type: DependencyType.DName,
                name: name,
                path: path,
                external: true,
                importAttributeType: Dependencies.extractImportAttributeType(field.meta),
                pos: field.pos
              });
            default:
          }
        default:
      }
      e.iter(addJsRequireFromExpr);
    }
    function addFromExpr(e: TypedExpr) {
      addJsRequireFromExpr(e);
      for (type in TypeUtil.typesInExpr(e))
        dependencies.add(type);
    }
    for (member in members) {
      switch member {
        case MClass(cl, _, fields):
          switch cl.interfaces {
            case null | []:
            case v:
              for (i in v)
                dependencies.add(TClassDecl(i.t));
          }
          switch cl.superClass {
            case null:
            case {t: t}: dependencies.add(TClassDecl(t));
          }
          #if (haxe_ver >= 4.2)
          addModuleFieldRequires(cl, fields);
          #end
          for (field in fields)
            addFromExpr(field.expr);
          addFromExpr(cl.init);
        case MMain(expr):
          addFromExpr(expr);
        default:
      }
    }
    if (module != 'genes.Register')
      dependencies.add(TypeUtil.registerType);
    endTimer();
    return codeDependencies = dependencies;
  }

  public function getMember(name: String) {
    for (member in members)
      switch member {
        case MClass({name: n}, _) | MEnum({name: n}, _) | MType({name: n}, _)
          if (n == name):
          return member;
        default:
      }
    return null;
  }

  static function hasExternSuper(s: ClassType)
    return switch s.superClass {
      case null: s.isExtern;
      case {t: _.get() => v}: hasExternSuper(v);
    }

  /**
   * Builds the emitter-facing field records for a typed class.
   *
   * With no surface, runtime emitters receive Haxe's post-DCE fields. Passing a
   * `PublicSurface` instead maps its pre-DCE, public-only members (including
   * overload identity) into the existing emitter record without coupling the
   * semantic model to target formatting. `retainedFields` can constrain class
   * declarations to the modules/members in the current runtime graph until the
   * declaration-only `DependencyPlan` owns independent reachability; interfaces
   * deliberately remain complete. Classic JS therefore stays compact while TS
   * interfaces and `.d.ts` consume the same API facts.
   */
  public static function fieldsOf(cl: ClassType,
      ?publicSurface: PublicSurface, ?surfaceParams: Array<Type>,
      includeCompilerGenerated = false, ?retainedFields: Array<Field>) {
    final fields: Array<Field> = [];
    final classDisableNativeAccessors = haxe.macro.Context.defined('genes.disable_native_accessors')
      || cl.meta.has(':genes.disableNativeAccessors');
    inline function extractTsType(meta: MetaAccess): Null<String> {
      return switch meta.extract(':ts.type') {
        case [{params: [{expr: EConst(CString(type))}]}]: type;
        default:
          switch meta.extract(':genes.type') {
            case [{params: [{expr: EConst(CString(type))}]}]: type;
            default: null;
          }
      }
    }
    function paramsFor(member: PublicMember): Array<TypeParameter> {
      final params = switch cl.kind {
        case KAbstractImpl(_.get().params => params) if (member.isStatic):
          params.copy();
        default:
          [];
      }
      for (parameter in member.parameters) {
        if (params.filter(existing -> existing.name == parameter.name).length == 0)
          params.push(parameter);
      }
      return params;
    }
    function fieldFromPublicMember(member: PublicMember): Field {
      if (member.isConstructor) {
        return {
          kind: Constructor,
          type: member.type,
          meta: member.meta,
          expr: member.expr,
          pos: member.pos,
          name: 'new',
          isStatic: false,
          #if (haxe_ver >= 4.2)
          isAbstract: false,
          #end
          isPublic: true,
          params: member.copyParameters(),
          doc: member.doc,
          getter: false,
          setter: false,
          tsType: null,
          overloads: [
            for (signature in member.overloads)
              fieldFromPublicMember(signature)
          ]
        };
      }
      final isVar = member.meta.has(':isVar');
      final disableNativeAccessors = member.meta.has(':genes.disableNativeAccessors')
        || classDisableNativeAccessors;
      return {
        kind: switch member.kind {
          case FVar(_, _): Property;
          case FMethod(_): Method;
        },
        meta: member.meta,
        name: member.name,
        type: member.type,
        expr: member.expr,
        pos: member.pos,
        isStatic: member.isStatic,
        #if (haxe_ver >= 4.2)
        isAbstract: member.isAbstract,
        #end
        isPublic: true,
        params: paramsFor(member),
        doc: member.doc,
        getter: !disableNativeAccessors && !isVar
          && member.kind.match(FVar(AccCall, AccCall | AccNever)),
        setter: !disableNativeAccessors && !isVar
          && member.kind.match(FVar(AccCall | AccNever, AccCall)),
        tsType: extractTsType(member.meta),
        overloads: [
          for (signature in member.overloads)
            fieldFromPublicMember(signature)
        ]
      };
    }
    if (publicSurface != null) {
      final concreteTypes = surfaceParams == null
        ? cl.params.map(parameter -> parameter.t)
        : surfaceParams;
      final constructor = publicSurface.constructorFor(concreteTypes);
      function isRetained(member: PublicMember): Bool {
        return switch retainedFields {
          case null:
            true;
          case fieldsToMatch:
            Lambda.exists(fieldsToMatch, field -> field.isStatic == member.isStatic
              && (member.isConstructor
                ? field.kind.match(Constructor)
                : field.name == member.name));
        };
      }
      if (constructor != null && isRetained(constructor))
        fields.push(fieldFromPublicMember(constructor));
      for (member in publicSurface.instanceMembersFor(concreteTypes)) {
        if ((includeCompilerGenerated || !member.isCompilerGenerated)
          && isRetained(member))
          fields.push(fieldFromPublicMember(member));
      }
      for (member in publicSurface.staticMembersFor(concreteTypes)) {
        if ((includeCompilerGenerated || !member.isCompilerGenerated)
          && isRetained(member))
          fields.push(fieldFromPublicMember(member));
      }
      return fields;
    }
    switch cl.constructor {
      case null:
      case ctor:
        final e = ctor.get().expr();
        fields.push({
          kind: Constructor,
          type: e.t,
          meta: null,
          expr: e,
          pos: e.pos,
          name: 'new',
          isStatic: false,
          #if (haxe_ver >= 4.2)
          isAbstract: false,
          #end
          isPublic: ctor.get().isPublic,
          params: [],
          doc: null,
          getter: false,
          setter: false,
          tsType: null,
          overloads: [
            for (signature in ctor.get().overloads.get())
              fieldFromPublicMember(PublicMember.capture(signature, false,
                true, false))
          ]
        });
    }
    for (field in cl.fields.get()) {
      final isVar = field.meta.has(':isVar');
      final disableNativeAccessors = field.meta.has(':genes.disableNativeAccessors')
        || classDisableNativeAccessors;
      fields.push({
        kind: switch field.kind {
          case FVar(_, _): Property;
          case FMethod(_): Method;
        },
        meta: field.meta,
        name: field.name,
        type: field.type,
        expr: field.expr(),
        pos: field.pos,
        isStatic: false,
        #if (haxe_ver >= 4.2)
        isAbstract: field.isAbstract,
        #end
        isPublic: field.isPublic,
        params: field.params,
        doc: field.doc,
        getter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall, AccCall | AccNever)),
        setter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall | AccNever, AccCall)),
        tsType: extractTsType(field.meta),
        overloads: [
          for (signature in field.overloads.get())
            fieldFromPublicMember(PublicMember.capture(signature, false,
              false, false))
        ]
      });
    }
    for (field in cl.statics.get()) {
      final isVar = field.meta.has(':isVar');
      final disableNativeAccessors = field.meta.has(':genes.disableNativeAccessors')
        || classDisableNativeAccessors;
      fields.push({
        kind: switch field.kind {
          case FVar(_, _): Property;
          case FMethod(_): Method;
        },
        meta: field.meta,
        name: field.name,
        type: field.type,
        expr: field.expr(),
        pos: field.pos,
        isStatic: true,
        #if (haxe_ver >= 4.2)
        isAbstract: false,
        #end
        isPublic: field.isPublic,
        params: {
          final params = switch cl.kind {
            case KAbstractImpl(_.get().params => params): params;
            default: [];
          }
          for (param in field.params) {
            if (params.filter(p -> p.name == param.name).length > 0)
              continue;
            params.push(param);
          }
          params;
        },
        doc: field.doc,
        getter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall, AccCall | AccNever)),
        setter: !disableNativeAccessors && !isVar
        && field.kind.match(FVar(AccCall | AccNever, AccCall)),
        tsType: extractTsType(field.meta),
        overloads: [
          for (signature in field.overloads.get())
            fieldFromPublicMember(PublicMember.capture(signature, true,
              false, false))
        ]
      });
    }
    return fields;
  }

  public function createContext(api: haxe.macro.JSGenApi): genes.Context {
    final typeAccessor = (type: TypeAccessor) -> switch type {
      case Abstract(name) | Concrete(_, name, _): name;
    }
    final context: genes.Context = {
      expr: api.generateStatement,
      value: api.generateValue,
      hasFeature: api.hasFeature,
      addFeature: api.addFeature,
      typeAccessor: typeAccessor
    }
    api.setTypeAccessor(type -> context.typeAccessor(type));
    return context;
  }
}
