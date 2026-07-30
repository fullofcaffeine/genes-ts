package genes;

import haxe.macro.JSGenApi;
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Expr.Constant;
import haxe.macro.Expr.ExprDef;
import haxe.macro.Type;
import haxe.crypto.Sha256;
import haxe.io.Path;
import genes.es.ModuleEmitter;
import genes.ts.TsModuleEmitter;
import genes.ts.StdTypesEmitter;
import genes.dts.DefinitionEmitter;
import genes.util.TypeUtil;
import genes.Module;
import genes.DependencyPlan.DependencyEdgeKind;
import genes.DependencyPlan.DependencyImportSpec;
import genes.JsxPlan.JsxCapabilityPolicy;
import sys.FileSystem;

using Lambda;
using StringTools;

/**
 * Orchestrates the shared Haxe-to-TypeScript/classic-JavaScript pipeline.
 *
 * Why: both output profiles must consume the same typed modules, semantic
 * plans, reachability, diagnostics, and publication contract or they will
 * silently diverge as language coverage grows.
 *
 * What: this class installs the custom JS generator, isolates Haxe's own output
 * cleanup, constructs module graphs, validates target capabilities, selects
 * profile printers, and commits implementation/declaration artifacts together.
 *
 * How: Haxe's typed AST remains authoritative; narrow immutable plans feed
 * target-specific emitters, and `OutputTransaction` is the only public
 * filesystem owner. Generation diagnostics must use `CompilerDiagnostic` so
 * stack unwinding always crosses the transaction cleanup boundary.
 */
class Generator {
  /**
   * Selects the exact Genes-owned output entrypoint for one compilation.
   *
   * Why: a host tool may need to reuse one checked HXML plan while generating
   * an isolated TypeScript, TSX, JavaScript, JSX, or ESM comparison tree.
   * Adding a second `-js` argument is not an override: Haxe rejects it as a
   * second target before Genes can install its transactional generator.
   *
   * What/How: `-D genes.output=<path>` replaces only the configured Genes
   * destination. Haxe's original `-js` path is redirected to the same private
   * compiler sentinel as every other Genes build, while `OutputTransaction`
   * owns the selected path and its exact extension. Compiler defines belong to
   * one request, so a warm compiler cannot retain another request's override.
   */
  public static inline final OUTPUT_DEFINE = 'genes.output';

  @:persistent static var generation = 0;
  static var configuredOutputFile: Null<String>;
  static var compilerSentinelFile: Null<String>;
  static var configuredOutputOverridePresent = false;
  static var configuredOutputOverride: Null<String>;
  static var configuredTypeScriptProfile = false;

  static function generate(api: JSGenApi) {
    validateOutputOverrideTiming();
    final outputFile = configuredOutputFile == null ? api.outputFile : configuredOutputFile;
    final output = Path.withoutExtension(Path.withoutDirectory(outputFile));
    final outputDir = Path.directory(outputFile);
    // The module name intentionally omits the extension, but filesystem
    // ownership must not. `index.ts` and `index.js` can coexist in one output
    // directory and need independent manifests and staging directories.
    final outputIdentity = Path.withoutDirectory(Path.normalize(outputFile));
    final outputTransaction = new OutputTransaction(outputDir, outputIdentity);

    try {
      removeCompilerSentinel();
      generateTransactional(api, outputFile, output, outputTransaction);
    } catch (error:haxe.Exception) {
      try {
        outputTransaction.abort();
        removeCompilerSentinel();
      } catch (rollbackError:haxe.Exception) {
        throw new haxe.Exception('Genes failed to restore compiler output after '
          + '"${error.message}": ${rollbackError.message}',
          rollbackError);
      }
      throw error;
    }
    removeCompilerSentinel();
  }

  /**
   * Plans and emits one compilation entirely into a private transaction.
   *
   * Why: the outer `generate()` isolates Haxe's compiler-owned output sentinel.
   * Keeping all semantic work here guarantees every diagnostic, not only
   * printer failures, crosses the same rollback boundary.
   *
   * What/How: typed modules, reachability, capability checks, implementation
   * files, declarations, source maps, and TS support files are accumulated in
   * `outputTransaction`; public output changes only at the final commit.
   */
  static function generateTransactional(api: JSGenApi, outputFile: String,
      output: String, outputTransaction: OutputTransaction): Void {
    ModuleDirectivePlan.validate();
    final toGenerate = typesPerModule(api.types);
    final extension = Path.extension(outputFile);
    final outputDir = Path.directory(outputFile);
    Genes.outExtension = extension.length > 0 ? '.$extension' : extension;
    final modules = new Map();
    final expose: Map<String, ModuleExport> = new Map();
    final concrete = [];
    function export(export: ModuleExport) {
      if (expose.exists(export.name)) {
        final duplicate = expose.get(export.name);
        // A public Haxe module field is discovered before semantic lowering.
        // When that exact field is later selected as a genuine module
        // function, both discoveries describe the same ESM export rather than
        // two competing owners. Preserve the first stable fact and let the
        // module-function plan own the emitted declaration.
        if (!export.isType
          && !duplicate.isType
          && export.module == duplicate.module
          && Context.getPosInfos(export.pos)
            .min == Context.getPosInfos(duplicate.pos)
            .min && Context.getPosInfos(export.pos)
          .max == Context.getPosInfos(duplicate.pos)
          .max)
          return;
        Context.warning('Trying to @:expose ${export.name} ...', export.pos);
        CompilerDiagnostic.fail('... but there\'s already an export by that name',
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
            // A selected genuine module field is exported by its own ESM
            // module. It is not a compilation-root barrel export: separate
            // modules may intentionally own the same conventional binding
            // (for example `render`) without competing globally.
            if (field.meta.has(':expose')
              && !field.meta.has(':genes.moduleFunction')
              && !field.meta.has(':genes.moduleValue'))
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
          if (base.meta.has(':expose') || LibraryProfile.isRoot(base))
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
        CompilerDiagnostic.fail('Genes: Module name "${module}" is the same as the output file name "${output}".',
          Context.currentPos());
      addModule(module, types);
    }
    final tsMode = Context.defined('genes.ts');
    if (tsMode && Genes.outExtension == '.jsx')
      CompilerDiagnostic.fail('[GTS-JSX-CAPABILITY-007] `.jsx` is the '
        + 'type-erased JSX profile and cannot be combined with `-D genes.ts`. '
        +
        'Remove that define for `.jsx`, or emit `.tsx` to preserve Haxe-derived '
        + 'TypeScript types.',
        Context.currentPos());

    final initialNames = [for (name in modules.keys()) name];
    initialNames.sort(Reflect.compare);
    final explicitlyExposedModules = new Map<String, Bool>();
    for (item in expose)
      explicitlyExposedModules.set(item.module, true);

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
          CompilerDiagnostic.fail('Genes DependencyPlan ($profile): missing source module '
            + moduleName,
            Context.currentPos());

        final edges = sourceModule.dependencyPlan.edges;
        for (edge in edges) {
          if (!DependencyPlan.containsKind(kinds, edge.kind))
            continue;
          switch edge.importSpec {
            case Bound(importSpec) if (importSpec.external):
              continue;
            case SideEffect(request) if (request.external):
              continue;
            default:
          }
          final referencedType = edge.referencedType;
          if (referencedType == null) {
            if (edge.importSpec != null)
              CompilerDiagnostic.fail('Genes DependencyPlan ($profile) has an internal '
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
            CompilerDiagnostic.fail('Genes DependencyPlan ($profile) cannot resolve '
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
            changed = target.addTypes([DependencyPlan.moduleTypeToType(referencedType)]);
          }

          final hasMember = target.getMember(base.name) != null
            || target.getMember(TypeUtil.baseTypeName(base)) != null;
          if (!hasMember)
            CompilerDiagnostic.fail('Genes DependencyPlan ($profile) retained '
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

    final hasPublicModuleFunctions = initialNames.exists(name ->
      hasPublicModuleFunctionCandidate(modules.get(name)));
    final implementationRoots = if (tsMode) [
      for (name in initialNames)
        if (isTypedImplementationRoot(modules.get(name),
          explicitlyExposedModules.exists(name))
          || (name == output && hasPublicModuleFunctions)) name
    ] else [
      for (name in initialNames)
        if (needsGen(modules.get(name))
          || (name == output && hasPublicModuleFunctions)) name
    ];
    final implementationKinds = if (tsMode)
      [RuntimeValue, RuntimeSideEffect, TypeOnly] else
      [RuntimeValue, RuntimeSideEffect];
    final implementationReachable = expandReachability(implementationRoots,
      implementationKinds, tsMode ? 'ts-strict' : 'classic-esm');
    final implementationNames = [
      for (name in implementationReachable.keys())
        name
    ];
    implementationNames.sort(Reflect.compare);
    final jsxCapability = JsxCapabilityPolicy.current();
    // Validate every reachable module before an emitter opens its buffered
    // writer. Capability failures therefore cannot leave a mixed output tree.
    for (name in implementationNames) {
      final module = modules.get(name);
      jsxCapability.validate(module.jsxPlan);
      // Resolve the edge here as well as in emitters so alias/capability
      // failures are diagnosed before any module writer is opened.
      jsxCapability.resolveRuntimeBinding(module.codeDependencies,
        module.jsxPlan);
    }
    // Public module functions must not force ModuleFunctionPlan ahead of other
    // semantic plans: a malformed template/JSX carrier owns the earlier source
    // diagnostic. Once every reachable module has passed those checks, collect
    // validated public bindings before any emitter opens a staged writer.
    final outputModule = modules.get(output);
    for (moduleName in implementationNames) {
      final module = modules.get(moduleName);
      for (entry in module.moduleFunctionPlan.rootPublicEntries()) {
        final publicName = entry.publicExportName;
        if (publicName == null)
          continue;
        final publicExport = {
          name: publicName,
          pos: entry.requestedPos,
          isType: false,
          module: moduleName
        };
        export(publicExport);
        outputModule.expose.push(publicExport);
      }
    }
    for (name in implementationNames) {
      final module = modules.get(name);
      // `StdTypesEmitter` owns the canonical TS support module. The ordinary
      // typed module used to be emitted first and then overwritten, leaving an
      // orphan source map for text that no longer existed.
      if (tsMode && module.path == 'StdTypes')
        continue;
      if ((tsMode && hasImplementation(module))
        || (!tsMode && hasClassicImplementation(module)))
        generateImplementation(api, module, outputDir, outputTransaction);
    }

    if (tsMode) {
      final stdTypesPath = Path.join([outputDir, 'StdTypes'])
        + Genes.outExtension;
      // The normal manifest diff retires source maps produced by an older
      // Genes build. A historical filename alone is not ownership evidence:
      // the output directory may also contain a user-created file with that
      // name, so first builds must leave it untouched.
      StdTypesEmitter.emit(stdTypesPath, outputTransaction);
    }

    #if dts
    // Declaration expansion happens after executable output is complete. A
    // declaration-only type can therefore never broaden classic JS DCE or alter
    // a TS implementation module merely by being reachable from public types.
    final declarationReachable = expandReachability(implementationNames,
      [DeclarationOnly], 'classic-dts');
    final declarationNames = [
      for (name in declarationReachable.keys())
        name
    ];
    declarationNames.sort(Reflect.compare);
    for (name in declarationNames)
      generateDefinition(api, modules.get(name), outputDir, outputTransaction);
    #end

    // Private fault injection for the transaction harness. Every emitter has
    // completed, so the old per-file architecture would already have exposed
    // a mixed tree here; the transaction must still have touched nothing.
    #if genes.output_transaction_test_fail_before_commit
    CompilerDiagnostic.fail('Genes output transaction test failure before publication',
      Context.currentPos());
    #end
    // This private probe deliberately throws a plain Haxe value rather than a
    // CompilerDiagnostic. It verifies that every supported macro runtime wraps
    // such values as haxe.Exception before they cross generate()'s rollback
    // boundary. Keep it after all emitters so a passing test proves that real
    // staged TS/classic/declaration/map files are discarded.
    #if genes.output_transaction_test_raw_throw_before_commit
    throw 'Genes raw output transaction test failure before publication';
    #end
    outputTransaction.commit();
  }

  /**
   * Returns whether one module belongs in the current generated output tree.
   *
   * Why: a warm Haxe compilation server may reuse typed declarations and their
   * metadata across requests. `onGenerate` stamps every type with this
   * generator's current request number, but older stamps can remain attached
   * to a cached type. Requiring exactly one stamp caused later builds to omit
   * otherwise current modules such as dynamic-import chunks and standard
   * library support.
   *
   * What/How: exposed and main modules remain direct roots. Other declarations
   * qualify when any `@:genes.generate` entry matches the current `generation`
   * number. Old request stamps are ignored; they neither retain stale modules
   * nor hide a type that was visited again in this request.
   */
  static function needsGen(module: Module) {
    if (module.expose.length > 0)
      return true;
    for (member in module.members) {
      switch member {
        case MClass({meta: meta}, _, _) | MEnum({meta: meta}, _) |
          MType({meta: meta}, _):
          for (entry in meta.extract(':genes.generate')) {
            switch entry.params {
              case [{expr: EConst(CInt(stampedGeneration))}]
                if (stampedGeneration == Std.string(generation)):
                return true;
              default:
            }
          }
        case MMain(_):
          return true;
      }
    }
    return false;
  }

  /**
   * Finds only the metadata pair needed to retain the compilation-root module.
   *
   * This deliberately does not parse or validate either annotation. Full
   * validation remains in ModuleFunctionPlan after template/JSX planning, so a
   * shallow root decision cannot mask an earlier semantic diagnostic.
   */
  static function hasPublicModuleFunctionCandidate(module: Module): Bool {
    for (member in module.members) {
      switch member {
        case MClass(owner, _, fields):
          #if (haxe_ver >= 4.2)
          if (owner.kind.match(KModuleFields(_)))
            continue;
          #end
          for (field in Module.emittableFields(fields)) {
            if (field.meta != null
              && field.meta.has(':genes.moduleFunction')
              && field.meta.has(':expose'))
              return true;
          }
        case MEnum(_, _) | MType(_, _) | MMain(_):
      }
    }
    return false;
  }

  /**
   * Selects declarations that independently root a TypeScript source module.
   *
   * Why: Haxe may load ordinary typedef modules only while resolving the
   * fields of a host extern. Those aliases are not part of the emitted program
   * when the extern itself projects to an ambient TypeScript type, but rooting
   * every compiler-loaded typedef publishes the extern's entire support graph.
   *
   * What: concrete declarations, interfaces, enums, the main expression, and
   * explicit package exports remain roots. A module containing only typedefs
   * instead enters output through a real type edge from emitted syntax (or
   * through an explicit export), so user-authored aliases remain available
   * exactly when generated TypeScript can name them.
   *
   * How: this is deliberately provenance- and package-neutral. Reachability
   * still uses compiler-owned `ModuleType` references; no Haxe std path,
   * browser package, generated filename, or target spelling is inspected.
   */
  static function isTypedImplementationRoot(module: Module,
      explicitlyExposed: Bool): Bool {
    if (explicitlyExposed || module.expose.length > 0)
      return true;
    for (member in module.members)
      if (!member.match(MType(_, _)))
        return true;
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

  /** True when at least one member survives the final implementation policy. */
  static function hasImplementation(module: Module): Bool {
    if (module.expose.length > 0)
      return true;
    for (member in module.members)
      if (Module.memberProjection(member).emitImplementation)
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

  static function generateImplementation(api: JSGenApi, module: Module,
      outputDir: String, outputTransaction: OutputTransaction) {
    // Validate exact module bindings before this module opens even a staged
    // writer. OutputTransaction still protects earlier staged modules if a
    // later module fails, while the diagnostic points at the source metadata.
    module.moduleFunctionPlan;
    final path = Path.join([outputDir, module.path]) + Genes.outExtension;
    final ctx = module.createContext(api);
    final moduleEmitter = switch haxe.macro.Context.defined('genes.ts') {
      case true:
        final importExtension = if (haxe.macro.Context.defined('genes.ts.no_extension')
          || haxe.macro.Context.defined('genes.no_extension')) null else '.js';
        final emitter = new TsModuleEmitter(ctx,
          outputTransaction.writer(path));
        emitter.emitTsModule(module, importExtension);
        emitter;
      case false:
        final emitter = new ModuleEmitter(ctx, outputTransaction.writer(path));
        // JSX source is consumed by a JSX transform which writes `.js` files.
        // NodeNext and modern bundlers resolve a source-side `.js` specifier to
        // the sibling `.jsx` module, then preserve the runtime-correct suffix.
        final importExtension = Genes.outExtension == '.jsx' ? '.js' : Genes.outExtension;
        emitter.emitModule(module, importExtension);
        emitter;
    }
    #if (debug || js_source_map)
    moduleEmitter.emitSourceMap(path + '.map', true, outputTransaction);
    #end
    moduleEmitter.finish();
  }

  #if dts
  static function generateDefinition(api: JSGenApi, module: Module,
      outputDir: String, outputTransaction: OutputTransaction) {
    final definition = [Path.join([outputDir, module.path]), 'd.ts'].join('.');
    final ctx = module.createContext(api);
    final definitionEmitter = new DefinitionEmitter(ctx,
      outputTransaction.writer(definition));
    definitionEmitter.emitDefinition(module);
    #if (debug || js_source_map)
    definitionEmitter.emitSourceMap(definition + '.map', true,
      outputTransaction);
    #end
    definitionEmitter.finish();
  }
  #end

  #if macro
  public static function use() {
    #if !genes.disable
    if (Context.defined('js')) {
      final alreadyInstalled = Context.defined(CompilerInternal.GENERATOR_ACTIVE_DEFINE);
      Compiler.define(CompilerInternal.GENERATOR_ACTIVE_DEFINE);
      isolateCompilerOutput(alreadyInstalled);
      LibraryProfile.validate();
      ModuleDirectivePlan.install();
      // TypeScript implementation output and classic declaration output both
      // need source-level signatures captured before runtime-oriented DCE.
      if (Context.defined('genes.ts') || Context.defined('dts')
        || LibraryProfile.isEnabled()) {
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
      Context.onAfterGenerate(removeCompilerSentinel);
      Compiler.setCustomJSGenerator(Generator.generate);
    }
    #end
  }
  #end

  /**
   * Redirects Haxe's compiler-owned output slot away from the public tree.
   *
   * Why: Haxe may remove the configured `-js` path after a custom generator
   * reports an error. No restoration performed inside that callback can be
   * late enough to survive the compiler's cleanup.
   *
   * What: Genes remembers the user path and gives Haxe a deterministic private
   * sentinel in the system temporary directory. The custom generator publishes
   * only to the remembered path through `OutputTransaction`.
   *
   * How: the sentinel key hashes the absolute destination, so independent
   * outputs do not collide while concurrent writers to the same destination
   * retain the same unavoidable serialization requirement. The request-local
   * generator capability distinguishes a repeated `use()` call in one
   * compilation from a later compiler-server request; process-persistent
   * sentinel state alone cannot establish that boundary after a failed macro.
   */
  static function isolateCompilerOutput(alreadyInstalled: Bool): Void {
    final compilerOutput = Compiler.getOutput();
    if (compilerOutput == null || compilerOutput.length == 0)
      return;

    final overridePresent = Context.defined(OUTPUT_DEFINE);
    final overrideValue = Context.definedValue(OUTPUT_DEFINE);
    final requestedOutput = switch overrideValue {
      case null:
        compilerOutput;
      case value:
        value;
    }
    if (compilerSentinelFile != null && compilerOutput == compilerSentinelFile) {
      if (alreadyInstalled) {
        // Validate on every call. A previous implementation returned as soon
        // as it saw the sentinel, allowing a later invalid define to bypass
        // the public host contract.
        validateConfiguredOutput(requestedOutput);
        return;
      }
      if (!overridePresent) {
        removeCompilerSentinel();
        Context.error('[GENES-OUTPUT-TARGET-004] Haxe reused Genes\' private '
          + 'compiler sentinel as a new request\'s configured `-js` output. '
          + 'Restart the compilation server so the authored target can be '
          + 'captured safely.',
          Context.currentPos());
      }
    }

    final temporaryRoot = switch Sys.getEnv('TMPDIR') {
      case null | '':
        switch Sys.getEnv('TEMP') {
          case null | '': '.';
          case value: value;
        }
      case value: value;
    }
    // Redirect Haxe before validating the host-selected path. A macro
    // diagnostic can make Haxe clean its compiler-owned output, and that
    // cleanup must never touch either the authored HXML destination or a
    // previously good Genes tree.
    final sentinelSeed = requestedOutput.trim().length == 0
      || requestedOutput.indexOf('\x00') >= 0 ? compilerOutput : requestedOutput;
    final key = Sha256.encode(absolutePath(sentinelSeed)).substr(0, 20);
    compilerSentinelFile = Path.join([temporaryRoot, 'genes-haxe-output-$key.tmp']);
    Compiler.setOutput(compilerSentinelFile);
    validateConfiguredOutput(requestedOutput);
    configuredOutputFile = requestedOutput;
    configuredOutputOverridePresent = overridePresent;
    configuredOutputOverride = overrideValue;
    configuredTypeScriptProfile = Context.defined('genes.ts');
  }

  /**
   * Validates only the explicit host override, preserving legacy HXML policy.
   *
   * Existing direct `-js` builds keep their established extension behavior.
   * The new override is intentionally closed because it is a reusable tooling
   * API: a misspelled extension must not publish a syntactically incompatible
   * tree under an arbitrary filename.
   */
  static function validateConfiguredOutput(output: String): Void {
    if (!Context.defined(OUTPUT_DEFINE))
      return;
    // Haxe represents a valueless `-D name` as the string "1".
    if (output == '1' || output.trim().length == 0
      || output.indexOf('\x00') >= 0) {
      removeCompilerSentinel();
      Context.error('[GENES-OUTPUT-TARGET-001] -D $OUTPUT_DEFINE=<path> '
        + 'requires one explicit, non-empty output path.',
        Context.currentPos());
    }

    // The suffix is later used verbatim for generated files and import
    // requests. Accepting `.MJS` as though it were `.mjs` would pass this
    // validation but still produce case-sensitive paths that Node rejects.
    final extension = Path.extension(output);
    final supported = if (Context.defined('genes.ts')) extension == 'ts'
      || extension == 'tsx' else extension == 'js' || extension == 'jsx'
      || extension == 'mjs';
    if (!supported) {
      removeCompilerSentinel();
      final expected = Context.defined('genes.ts') ? '.ts or .tsx' : '.js, .jsx, or .mjs';
      Context.error('[GENES-OUTPUT-TARGET-002] -D $OUTPUT_DEFINE="$output" '
        + 'does not match the active Genes profile; expected $expected.',
        Context.currentPos());
    }
  }

  /**
   * Rejects a macro that changes output ownership after generator installation.
   *
   * Why: `isolateCompilerOutput()` redirects Haxe and captures the public
   * transaction owner before typing. Accepting a later macro mutation would
   * make the sentinel, transaction, and generated tree disagree about which
   * destination they protect.
   *
   * What/How: compare the output define and the `genes.ts` profile flag with
   * the exact request-local snapshot taken during installation. Both choose
   * the syntax and legal filename family, so changing either one later could
   * publish TypeScript under `.js` or classic JavaScript under `.ts`.
   * Ordinary command-line defines are already available at installation. A
   * later macro change fails before an `OutputTransaction` or public writer is
   * created.
   */
  static function validateOutputOverrideTiming(): Void {
    final currentPresent = Context.defined(OUTPUT_DEFINE);
    final currentValue = Context.definedValue(OUTPUT_DEFINE);
    final currentTypeScriptProfile = Context.defined('genes.ts');
    if (currentPresent == configuredOutputOverridePresent
      && currentValue == configuredOutputOverride
      && currentTypeScriptProfile == configuredTypeScriptProfile) {
      return;
    }

    removeCompilerSentinel();
    Context.error('[GENES-OUTPUT-TARGET-003] -D $OUTPUT_DEFINE and '
      + '`-D genes.ts` must be configured before genes.Generator.use(); a '
      + 'macro changed output-selection policy after Genes captured the '
      + 'transactional owner and profile.',
      Context.currentPos());
  }

  /** Removes only the private file path installed by `isolateCompilerOutput`. */
  static function removeCompilerSentinel(): Void {
    final path = compilerSentinelFile;
    if (path == null || !FileSystem.exists(path))
      return;
    if (FileSystem.isDirectory(path))
      throw new haxe.Exception('Genes compiler output sentinel is a directory: $path');
    FileSystem.deleteFile(path);
  }

  static function absolutePath(path: String): String {
    return Path.normalize(FileSystem.absolutePath(path)).replace('\\', '/');
  }
}
