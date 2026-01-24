package genes;

import haxe.macro.JSGenApi;
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Type;
import haxe.io.Path;
import genes.es.ModuleEmitter;
import genes.ts.TsModuleEmitter;
import genes.dts.DefinitionEmitter;
import genes.util.TypeUtil;
import genes.Module;

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

    // TS output needs all type-reachable modules to exist on disk, even if Haxe DCE
    // would normally strip them from runtime output (type-only reachability).
    //
    // Until we have a dedicated "type graph" emission mode (M6), we conservatively
    // include any missing modules referenced by type dependencies so `tsc` can
    // resolve imports under `-dce full`.
    if (tsMode) {
      final pending = [for (k in modules.keys()) k];
      var i = 0;
      while (i < pending.length) {
        final moduleName = pending[i++];
        final m = modules.get(moduleName);
        if (m == null)
          continue;
        for (path => imports in m.typeDependencies.imports) {
          if (imports.length == 0)
            continue;
          if (imports[0].external)
            continue;
          // `StdTypes` is generated as a special TS-only file.
          if (path == 'StdTypes')
            continue;
          if (modules.exists(path))
            continue;
          final types: Array<Type> = [];
          for (dep in imports) {
            final fullName = {
              final parts = path.split('.');
              final last = parts[parts.length - 1];
              (last == dep.name) ? path : (path + '.' + dep.name);
            };
            try {
              types.push(Context.getType(fullName));
            } catch (_: Dynamic) {}
          }
          if (types.length > 0) {
            addModule(path, types);
            pending.push(path);
          }
        }
      }
    }

    for (module in modules) {
      if (tsMode || needsGen(module))
        generateModule(api, module);
    }

    if (tsMode) {
      emitStdTypes(Path.join([outputDir, 'StdTypes']) + Genes.outExtension);
    }
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

  static function generateModule(api: JSGenApi, module: Module) {
    final outputDir = Path.directory(api.outputFile);
    final path = Path.join([outputDir, module.path]) + Genes.outExtension;
    final definition = [Path.join([outputDir, module.path]), 'd.ts'].join('.');
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
    #if dts
    final definitionEmitter = new DefinitionEmitter(ctx,
      Writer.bufferedFileWriter(definition));
    definitionEmitter.emitDefinition(module);
    #if (debug || js_source_map)
    definitionEmitter.emitSourceMap(definition + '.map', true);
    #end
    definitionEmitter.finish();
    #end
  }

  static function emitStdTypes(path: String) {
    final writer = Writer.bufferedFileWriter(path);
    writer.write('export type Iterator<T> = { hasNext(): boolean; next(): T };\n');
    // Map keys in Haxe can be primitives or objects. We avoid `any`/`unknown`
    // here to keep non-runtime output strongly typed under the typing policy.
    writer.write('export type HxMapKey = string | number | boolean | symbol | object | null;\n');
    // Haxe `Iterable<T>` is structural: anything with `iterator(): Iterator<T>`.
    // Arrays are also valid iterables in Haxe.
    // In genes-ts we also treat `haxe.Constraints.IMap`-like shapes as iterable
    // over values (via `keys()` + `get()`), even when DCE removes an explicit
    // `iterator()` method.
    writer.write('export type Iterable<T> = { iterator(): Iterator<T> } | { keys(): Iterator<HxMapKey>; get(k: HxMapKey): T | null } | Array<T>;\n');
    writer.write('export type KeyValueIterator<K, V> = Iterator<{ key: K; value: V }>;\n');
    writer.write('export type KeyValueIterable<K, V> = { keyValueIterator(): KeyValueIterator<K, V> };\n');
    writer.write('export interface ArrayAccess<T> {}\n');
    writer.write('declare global {\n');
    // Haxe/JS stdlib uses `__name__` both as a marker (`true`) and as a
    // human-readable name (e.g. `"String"`).
    writer.write('  interface StringConstructor { __name__?: string | boolean }\n');
    writer.write('  interface ArrayConstructor { __name__?: string | boolean }\n');
    // Some Haxe JS externs are generated from Mozilla WebIDL and are not part of
    // TypeScript's standard `lib.dom.d.ts` surface. Provide minimal global types
    // so generated TS can type-check under `skipLibCheck: false`.
    writer.write('  interface PositionError { readonly code: number; readonly message: string }\n');
    writer.write('  const PositionError: { readonly PERMISSION_DENIED: 1; readonly POSITION_UNAVAILABLE: 2; readonly TIMEOUT: 3; readonly prototype: PositionError };\n');
    writer.write('  interface FetchObserver { readonly state: \"requesting\" | \"responding\" | \"aborted\" | \"errored\" | \"complete\"; onstatechange: Function; onrequestprogress: Function; onresponseprogress: Function }\n');
    writer.write('  const FetchObserver: { readonly prototype: FetchObserver };\n');
    writer.write('}\n');
    // These value-level stubs exist for compatibility with Haxe reflection-ish
    // patterns, but they do not carry meaningful runtime values in JS.
    writer.write('export const Iterator: null = null;\n');
    writer.write('export const Iterable: null = null;\n');
    writer.write('export const KeyValueIterator: null = null;\n');
    writer.write('export const KeyValueIterable: null = null;\n');
    writer.write('export const ArrayAccess: null = null;\n');
    writer.close();
  }

  #if macro
  public static function use() {
    #if !genes.disable
    if (Context.defined('js')) {
      if (Context.defined('genes.ts')) {
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
