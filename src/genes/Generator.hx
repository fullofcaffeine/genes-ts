package genes;

import haxe.macro.JSGenApi;
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.io.Path;
import genes.es.ModuleEmitter;
import genes.ts.TsModuleEmitter;
import genes.ts.StdTypesEmitter;
import genes.dts.DefinitionEmitter;
import genes.util.TypeUtil;
import genes.Module;
import genes.DependencyPlan.DependencyEdgeKind;

using Lambda;
using StringTools;

class Generator {
  @:persistent static var generation = 0;

  static function generate(api: JSGenApi) {
    final toGenerate = typesPerModule(api.types);
    final output = Path.withoutExtension(Path.withoutDirectory(api.outputFile));
    final extension = Path.extension(api.outputFile);
    final outputDir = Path.directory(api.outputFile);
    Genes.outExtension = extension.length > 0 ? '.$extension' : extension;
    final modules = new Map();
    final expose: Map<String, ModuleExport> = new Map();
    final concrete = [];
    function export(export: ModuleExport) {
      if (expose.exists(export.name)) {
        final duplicate = expose.get(export.name);
        Context.warning('Trying to @:expose ${export.name} ...', export.pos);
        Context.error('... but there\'s already an export by that name',
          duplicate.pos);
      }
      expose.set(export.name, export);
    }
    for (type in api.types) {
      switch type {
        #if (haxe_ver >= 4.2)
        case TInst(_.get() => {
          kind: KModuleFields(_),
          module: module,
          statics: _.get() => fields
        }, _):
          for (field in fields) {
            if (field.meta.has(':expose'))
              export({
                name: field.name,
                pos: field.pos,
                isType: false,
                module: module
              });
          }
        #end
        default:
          final base = TypeUtil.typeToBaseType(type);
          if (base.meta.has(':expose'))
            export({
              name: base.name,
              pos: base.pos,
              isType: type.match(TType(_, _)),
              module: base.module
            });
      }
      switch type {
        case TEnum((_.get() : BaseType) => t, _) |
          TInst((_.get() : BaseType) => t, _):
          concrete.push(TypeUtil.baseTypeFullName(t));
        default:
      }
    }
    final context = {
      concrete: concrete,
      modules: modules
    }
    function addModule(module: String, types: Array<Type>,
        ?main: Null<TypedExpr>, ?expose: Array<ModuleExport>)
      modules.set(module, new Module(context, module, types, main, expose));

    addModule(output, switch toGenerate.get(output) {
      case null: [];
      case v: v;
    }, api.main, [for (t in expose) t]);

    for (module => types in toGenerate) {
      if (module.toLowerCase() == output.toLowerCase())
        Context.error('Genes: Module name "${module}" is the same as the output file name "${output}".',
          Context.currentPos());
      addModule(module, types);
    }
    final tsMode = Context.defined('genes.ts');

    final initialNames = [for (name in modules.keys()) name];
    initialNames.sort(Reflect.compare);

    /**
     * Expands one output profile from compiler-owned dependency refs.
     *
     * The queue may revisit a module when a same-module declaration is added:
     * its immutable plan is rebuilt and can reveal more edges. External/package
     * imports and target globals remain leaves. Any internal edge without a
     * typed declaration is a compiler diagnostic—there is no string-to-type
     * lookup or silent catch on this path.
     */
    function expandReachability(roots: Array<String>,
        kinds: Array<DependencyEdgeKind>, profile: String): Map<String, Bool> {
      final reachable = new Map<String, Bool>();
      final pending: Array<String> = [];
      function enqueue(name: String): Void {
        if (reachable.exists(name))
          return;
        reachable.set(name, true);
        pending.push(name);
      }
      final sortedRoots = roots.copy();
      sortedRoots.sort(Reflect.compare);
      for (root in sortedRoots)
        enqueue(root);

      var index = 0;
      while (index < pending.length) {
        final moduleName = pending[index++];
        final sourceModule = modules.get(moduleName);
        if (sourceModule == null)
          Context.error('Genes DependencyPlan ($profile): missing source module '
            + moduleName, Context.currentPos());

        final edges = sourceModule.dependencyPlan.edges;
        for (edge in edges) {
          if (!DependencyPlan.containsKind(kinds, edge.kind))
            continue;
          if (edge.importSpec != null && edge.importSpec.external)
            continue;
          final referencedType = edge.referencedType;
          if (referencedType == null) {
            if (edge.importSpec != null)
              Context.error('Genes DependencyPlan ($profile) has an internal '
                + 'import without a typed declaration '
                + '[${edge.provenance.rule}]',
                edge.provenance.sourcePosition);
            continue;
          }

          switch referencedType {
            case TAbstract(_):
              // Abstracts erase/project through their backing type and never own
              // an emitted module member.
              continue;
            case TClassDecl(_.get() => {kind: KTypeParameter(_)}):
              continue;
            default:
          }
          final base = DependencyPlan.moduleTypeBase(referencedType);
          if (base.isExtern || base.module == 'StdTypes')
            continue;
          if (base.module == null || base.module.length == 0)
            Context.error('Genes DependencyPlan ($profile) cannot resolve '
              + '${base.name} to an output module '
              + '[${edge.provenance.rule}]',
              edge.provenance.sourcePosition);

          var target = modules.get(base.module);
          var changed = false;
          if (target == null) {
            addModule(base.module,
              [DependencyPlan.moduleTypeToType(referencedType)]);
            target = modules.get(base.module);
            changed = true;
          } else {
            changed = target.addTypes(
              [DependencyPlan.moduleTypeToType(referencedType)]);
          }

          final hasMember = target.getMember(base.name) != null
            || target.getMember(TypeUtil.baseTypeName(base)) != null;
          if (!hasMember)
            Context.error('Genes DependencyPlan ($profile) retained '
              + '${TypeUtil.baseTypeFullName(base)} but could not materialize '
              + 'its emitted declaration [${edge.provenance.rule}]',
              edge.provenance.sourcePosition);

          if (!reachable.exists(base.module))
            enqueue(base.module);
          else if (changed)
            pending.push(base.module);
        }
      }
      return reachable;
    }

    final implementationRoots = if (tsMode)
      initialNames
    else
      [for (name in initialNames)
        if (needsGen(modules.get(name))) name];
    final implementationKinds = if (tsMode)
      [RuntimeValue, RuntimeSideEffect, TypeOnly]
    else
      [RuntimeValue, RuntimeSideEffect];
    final implementationReachable = expandReachability(implementationRoots,
      implementationKinds, tsMode ? 'ts-strict' : 'classic-esm');
    final implementationNames = [
      for (name in implementationReachable.keys()) name
    ];
    implementationNames.sort(Reflect.compare);
    for (name in implementationNames) {
      final module = modules.get(name);
      if (tsMode || hasClassicImplementation(module))
        generateImplementation(api, module);
    }

    if (tsMode)
      StdTypesEmitter.emit(Path.join([outputDir, 'StdTypes'])
        + Genes.outExtension);

    #if dts
    // Declaration expansion happens after executable output is complete. A
    // declaration-only type can therefore never broaden classic JS DCE or alter
    // a TS implementation module merely by being reachable from public types.
    final declarationReachable = expandReachability(implementationNames,
      [DeclarationOnly], 'classic-dts');
    final declarationNames = [
      for (name in declarationReachable.keys()) name
    ];
    declarationNames.sort(Reflect.compare);
    for (name in declarationNames)
      generateDefinition(api, modules.get(name));
    #end
  }

  static function needsGen(module: Module) {
    if (module.expose.length > 0)
      return true;
    for (member in module.members) {
      switch member {
        case MClass({meta: meta}, _, _) | MEnum({meta: meta}, _) |
          MType({meta: meta}, _):
          switch meta.extract(':genes.generate') {
            case [{params: [{expr: EConst(CInt(gen))}]}]:
              return true;
            default:
          }
        case MMain(_):
          return true;
      }
    }
    return false;
  }

  /** Mirrors classic `ModuleEmitter`'s type-erasure file boundary. */
  static function hasClassicImplementation(module: Module): Bool {
    if (module.expose.length > 0)
      return true;
    for (member in module.members)
      if (!member.match(MType(_, _)))
        return true;
    return false;
  }

  static function typesPerModule(types: Array<Type>) {
    final modules = new Map<String, Array<Type>>();
    for (type in types) {
      switch type {
        case TInst(_.get() => {
          module: module,
          isExtern: true,
          init: init
        }, _) if (init != null):
          #if (genes.extern_init_warning)
          Context.warning('Extern __init__ methods are not supported in genes. See https://github.com/benmerckx/genes/issues/13.',
            init.pos);
          #end
        case TInst(_.get() => {
          module: module,
          isExtern: false
        }, _) | TEnum(_.get() => {
          module: module,
          isExtern: false
        }, _) | TType(_.get() => {
          module: module
        }, _):
          if (modules.exists(module))
            modules.get(module).push(type);
          else
            modules.set(module, [type]);
        default:
      }
    }
    return modules;
  }

  static function generateImplementation(api: JSGenApi, module: Module) {
    final outputDir = Path.directory(api.outputFile);
    final path = Path.join([outputDir, module.path]) + Genes.outExtension;
    final ctx = module.createContext(api);
    final moduleEmitter = switch haxe.macro.Context.defined('genes.ts') {
      case true:
        final importExtension = if (haxe.macro.Context.defined('genes.ts.no_extension')
          || haxe.macro.Context.defined('genes.no_extension')) null else '.js';
        final emitter = new TsModuleEmitter(ctx,
          Writer.bufferedFileWriter(path));
        emitter.emitTsModule(module, importExtension);
        emitter;
      case false:
        final emitter = new ModuleEmitter(ctx,
          Writer.bufferedFileWriter(path));
        emitter.emitModule(module, Genes.outExtension);
        emitter;
    }
    #if (debug || js_source_map)
    moduleEmitter.emitSourceMap(path + '.map', true);
    #end
    moduleEmitter.finish();
  }

  #if dts
  static function generateDefinition(api: JSGenApi, module: Module) {
    final outputDir = Path.directory(api.outputFile);
    final definition = [Path.join([outputDir, module.path]), 'd.ts'].join('.');
    final ctx = module.createContext(api);
    final definitionEmitter = new DefinitionEmitter(ctx,
      Writer.bufferedFileWriter(definition));
    definitionEmitter.emitDefinition(module);
    #if (debug || js_source_map)
    definitionEmitter.emitSourceMap(definition + '.map', true);
    #end
    definitionEmitter.finish();
  }
  #end

  #if macro
  public static function use() {
    #if !genes.disable
    if (Context.defined('js')) {
      // TypeScript implementation output and classic declaration output both
      // need source-level signatures captured before runtime-oriented DCE.
      if (Context.defined('genes.ts') || Context.defined('dts')) {
        genes.PublicSurface.install();
        genes.ts.SignatureCache.install();
      }
      Compiler.include('genes.Register');
      Context.onGenerate(types -> {
        generation++;
        final pos = Context.currentPos();
        for (type in types) {
          switch type {
            case TEnum((_.get() : BaseType) => base, _) |
              TInst((_.get() : BaseType) => base, _) |
              TType((_.get() : BaseType) => base, _):
              base.meta.add(':genes.generate', [
                {
                  expr: ExprDef.EConst(CInt(Std.string(generation))),
                  pos: pos
                }
              ], pos);
            default:
          }
        }
      });
      Compiler.setCustomJSGenerator(Generator.generate);
    }
    #end
  }
  #end
}
