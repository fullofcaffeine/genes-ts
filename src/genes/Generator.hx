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
import genes.util.Timer.timer;
import genes.util.TypeUtil;
import genes.Module;
import genes.ReactRefreshModulePlan;
import genes.DependencyPlan.DependencyEdgeKind;
import genes.DependencyPlan.DependencyImportSpec;
import genes.JsxPlan.JsxCapabilityPolicy;
import genes.incremental.IncrementalShadow;
import genes.incremental.ModuleRequest;
import genes.incremental.RequestMeasure;
import sys.FileSystem;

using Lambda;
using StringTools;

/**
 * The facts of one generation that come from Haxe's type list alone, before
 * any `Module` value exists: the declarations of each output module, the
 * root exports, and the concrete class and enum names.
 *
 * Why: when a request leaves the walk with stored edges (Stage 3, slice S2),
 * `Generator.generateTransactional` builds new `Module` values and walks
 * again. It starts from these facts instead of reading the type list again,
 * because that step reports warnings (an extern `__init__` with
 * `-D genes.extern_init_warning`) that a request must report once.
 * `concrete` is a copy taken before any module added a name; each pass
 * copies it again. Request-local: it holds typed values only for the
 * request that made it.
 */
private typedef GenerationProgram = {
  final toGenerate: Map<String, Array<Type>>;
  final expose: Map<String, ModuleExport>;
  final concrete: Array<String>;
}

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
 * stack unwinding always crosses the transaction cleanup boundary. When Haxe
 * enables `--times`, request-local child timers expose the existing inventory,
 * reachability, validation, emission, and publication phases without writing
 * a second compiler report or retaining state between server requests.
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

  /**
   * Selects the Genes output entrypoint through a small file whose path stays
   * the same between requests.
   *
   * Why: Haxe 4.3.7 chooses its compiler-server cache by the values of all
   * defines. A development session that writes each build to a new private
   * folder and names that folder in `-D genes.output=<path>` gets a new cache
   * for every build: Haxe types the whole program again and the kept state of
   * Genes starts again. With this define the value stays the same, and only
   * the file content changes.
   *
   * What: `-D genes.output_descriptor=<path>` names a descriptor file with two
   * lines: `genes.output-descriptor-v1` and the base64 UTF-8 output path.
   * Example: a session writes `.genes/dev/haxe-request/genes-output.descriptor`
   * before each request. The path that the file names follows the same rules
   * as `-D genes.output`. A request must not set both defines.
   */
  public static inline final OUTPUT_DESCRIPTOR_DEFINE = 'genes.output_descriptor';

  static inline final OUTPUT_DESCRIPTOR_HEADER = 'genes.output-descriptor-v1';

  @:persistent static var generation = 0;
  static var configuredOutputFile: Null<String>;
  static var compilerSentinelFile: Null<String>;
  static var configuredOutputOverridePresent = false;
  static var configuredOutputOverride: Null<String>;
  static var configuredOutputDescriptor: Null<String>;
  static var configuredTypeScriptProfile = false;

  /**
   * Returns the output file that this request publishes, as `use()` captured
   * it: the `-js` path, or the path that `-D genes.output` or
   * `-D genes.output_descriptor` names.
   *
   * Read it only after `use()` ran in this request. Before that, the value
   * is not this request's path: it can be `null`, or, on a compiler server,
   * the value that an earlier request left. It is also `null` when the
   * request has no output path.
   *
   * Why: after `use()`, Haxe's own output slot (`Compiler.getOutput()`) names
   * a private sentinel file, not the real output. The incremental session key
   * (`GenerationChangeSet.outputKeyLines`) needs the real file name and folder
   * during typing, before `generate` runs.
   */
  public static function configuredOutput(): Null<String> {
    return configuredOutputFile;
  }

  static function generate(api: JSGenApi) {
    RequestMeasure.mark('genes.generate');
    validateOutputOverrideTiming();
    #if genes_generation_floor
    try {
      GenerationFloorProbe.run(api);
      removeCompilerSentinel();
      return;
    } catch (error:haxe.Exception) {
      removeCompilerSentinel();
      throw error;
    }
    #end
    final endTransactionSetupTimer = timer('genes.transaction.setup');
    final outputFile = configuredOutputFile == null ? api.outputFile : configuredOutputFile;
    final output = Path.withoutExtension(Path.withoutDirectory(outputFile));
    final outputDir = Path.directory(outputFile);
    // The module name intentionally omits the extension, but filesystem
    // ownership must not. `index.ts` and `index.js` can coexist in one output
    // directory and need independent manifests and staging directories.
    final outputIdentity = Path.withoutDirectory(Path.normalize(outputFile));
    final outputTransaction = new OutputTransaction(outputDir, outputIdentity);
    endTransactionSetupTimer();
    // Without `-D genes.dev_incremental`, or when the request descriptor does
    // not select the shadow, this returns at once and every hook below does
    // nothing, so the request runs exactly as before.
    IncrementalShadow.start(outputFile, outputTransaction);

    try {
      removeCompilerSentinel();
      generateTransactional(api, outputFile, output, outputTransaction);
    } catch (error:haxe.Exception) {
      IncrementalShadow.failed(error.message);
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
   *
   * `program` is given only for the live pass after a pass with stored edges
   * (Stage 3, slice S2; see the caller below). That pass builds new `Module`
   * values from the program facts of the first pass instead of reading the
   * type list again: a warning of that step, such as "Extern __init__
   * methods are not supported" with `-D genes.extern_init_warning`, is
   * reported once, and the plan work of the pass is timed as
   * `genes.plan.rerun`, not as a second inventory and walk.
   */
  static function generateTransactional(api: JSGenApi, outputFile: String,
      output: String, outputTransaction: OutputTransaction,
      ?program: GenerationProgram): Void {
    final given = program;
    final rerun = given != null;
    // A module request (G3) prints one module; see `generateModuleRequest`.
    // It never walks with stored edges, so it never reaches the live pass
    // after such a walk (`rerun`).
    if (!rerun) {
      final previewed = ModuleRequest.requestedTarget();
      final wrongDescriptor = previewed == null ? ModuleRequest.fullRequestRefusal(api.main != null) : null;
      if (wrongDescriptor != null)
        CompilerDiagnostic.fail(wrongDescriptor, Context.currentPos());
      if (previewed != null) {
        generateModuleRequest(api, outputFile, output, outputTransaction,
          previewed);
        return;
      }
    }
    var rerunTimerOpen = rerun;
    final rerunTimer = rerun ? timer('genes.plan.rerun') : () -> {};
    function endRerunTimer(): Void {
      if (!rerunTimerOpen)
        return;
      rerunTimerOpen = false;
      rerunTimer();
    }
    function planTimer(name: String): Void->Void {
      return rerun ? () -> {} : timer(name);
    }
    final endInventoryTimer = planTimer('genes.plan.inventory');
    // Typing and Haxe's filters are complete: declaration names are final.
    // The live pass after a pass with stored edges starts the name memo
    // again: with the memo of the first pass, a name that pass already found
    // is not searched again, so a module that asks for it first in the live
    // pass records no witness of the module that holds it (see
    // `IncrementalShadow.startRerun`).
    TypeUtil.startGenerationNames();
    if (!rerun)
      ModuleDirectivePlan.validate();
    // With `-D genes.compile_stage_profile`, `haxe --times` splits the
    // inventory stage into its whole-program loops (types, exports), the
    // `Module` values (modules) and the incremental shadow (shadow). A request
    // that replays stored output still runs the first two for every type.
    #if genes.compile_stage_profile
    final endInventoryTypesTimer = planTimer('genes.plan.inventory.types');
    #end
    final toGenerate = given != null ? given.toGenerate : typesPerModule(api.types);
    #if genes.compile_stage_profile
    endInventoryTypesTimer();
    final endInventoryExportsTimer = planTimer('genes.plan.inventory.exports');
    #end
    final extension = Path.extension(outputFile);
    final outputDir = Path.directory(outputFile);
    Genes.outExtension = extension.length > 0 ? '.$extension' : extension;
    final modules = new Map();
    final expose: Map<String,
      ModuleExport> = given != null ? given.expose : new Map();
    final concrete = given != null ? given.concrete.copy() : [];
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
    // The live pass after a pass with stored edges has these facts already.
    final programTypes: Array<Type> = rerun ? [] : api.types;
    for (type in programTypes) {
      switch type {
        #if (haxe_ver >= 4.2)
        case TInst(ownerRef, _)
          if (ownerRef.get().kind.match(KModuleFields(_))):
          final owner = ownerRef.get();
          final module = owner.module;
          final fields = owner.statics.get();
          for (field in fields) {
            final exposed = field.meta.has(':expose');
            // Only an exposed field can become a root export, so no other
            // field needs its module-function request here. The request
            // calls `Module.fieldsOf(owner)`, which copies every typed
            // function body of the module. Asking for each
            // `@:genes.moduleFunction` field (each React component) cost
            // seconds in a large build.
            //
            // The request also checks the marker. For a field without
            // `@:expose`, the module's `ModuleFunctionRequestPlan` does the
            // same check later, with the same diagnostic and before any
            // output is published. That plan skips compiler-internal
            // fields, so such a field keeps its check here.
            if (!exposed && !CompilerInternal.isField(field.meta))
              continue;
            // A selected genuine module field is exported by its own ESM
            // module. It is not a compilation-root barrel export: separate
            // modules may intentionally own the same conventional binding
            // (for example `render`) without competing globally.
            final request = ModuleFunctionRequestPlan.fromTypedFieldValues(owner,
              field);
            if (exposed && request == null)
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
    // The program facts before any `Module` adds a concrete name: the live
    // pass after a pass with stored edges starts from them.
    final programFacts: GenerationProgram = {
      toGenerate: toGenerate,
      expose: expose,
      concrete: concrete.copy()
    };
    #if genes.compile_stage_profile
    endInventoryExportsTimer();
    final endInventoryModulesTimer = planTimer('genes.plan.inventory.modules');
    #end
    final context: genes.Module.ModuleContext = {
      concrete: concrete,
      modules: modules,
      hasFeature: api.hasFeature,
      // One catalog for this request only; see JsxProviderSchemaCatalog.
      jsxProviderSchemas: new genes.JsxTypeChecker.JsxProviderSchemaCatalog(),
      // One catalog for this request only; see the class comment.
      explicitTypeArgumentDeclarations: new genes.ExplicitTypeArguments.ExplicitTypeArgumentDeclarations(),
      // One set of answers for this request only; see the class comment.
      jsonTypeDefinitions: new genes.JsonTypeSupport.JsonTypeDefinitionAnswers()
    }
    function addModule(module: String, types: Array<Type>,
        ?main: Null<TypedExpr>, ?expose: Array<ModuleExport>)
      modules.set(module, new Module(context, module, types, main, expose));
    // Inventory queries made while a module is built count as that module's
    // witnesses (incremental shadow only; otherwise this does nothing).
    function addInventoryModule(module: String, types: Array<Type>,
        ?main: Null<TypedExpr>, ?expose: Array<ModuleExport>) {
      IncrementalShadow.enter(module, Inventory);
      addModule(module, types, main, expose);
      IncrementalShadow.enter(null, Inventory);
    }

    addInventoryModule(output, switch toGenerate.get(output) {
      case null: [];
      case v: v;
    }, api.main, [for (t in expose) t]);

    for (module => types in toGenerate) {
      if (module.toLowerCase() == output.toLowerCase())
        CompilerDiagnostic.fail('Genes: Module name "${module}" is the same as the output file name "${output}".',
          Context.currentPos());
      addInventoryModule(module, types);
    }
    final tsMode = Context.defined('genes.ts');
    final exposedByModule = new Map<String, Array<String>>();
    for (item in expose) {
      final names = exposedByModule.get(item.module);
      if (names == null)
        exposedByModule.set(item.module, [item.name]);
      else
        names.push(item.name);
    }
    #if genes.compile_stage_profile
    endInventoryModulesTimer();
    final endInventoryShadowTimer = planTimer('genes.plan.inventory.shadow');
    #end
    IncrementalShadow.inventory(api.types, exposedByModule, output);
    #if genes.compile_stage_profile
    endInventoryShadowTimer();
    #end
    endInventoryTimer();
    if (tsMode && Genes.outExtension == '.jsx')
      CompilerDiagnostic.fail('[GTS-JSX-CAPABILITY-007] `.jsx` is the '
        + 'type-erased JSX profile and cannot be combined with `-D genes.ts`. '
        +
        'Remove that define for `.jsx`, or emit `.tsx` to preserve Haxe-derived '
        + 'TypeScript types.',
        Context.currentPos());

    /**
     * Expands one output profile from compiler-owned dependency refs.
     *
     * The queue may revisit a module when a same-module declaration is added:
     * its immutable plan is rebuilt and can reveal more edges. External/package
     * imports and target globals remain leaves. Any internal edge without a
     * typed declaration is a compiler diagnostic—there is no string-to-type
     * lookup or silent catch on this path.
     *
     * Stage 3, slice S2 (`recorded` is true only for the implementation
     * walk): each visit of a module turns the edges of its dependency plan
     * into target steps (`WalkStep`), and `takeStep` applies one step. With
     * an active incremental generator the steps of each visit are recorded,
     * keyed by the member list of the module at that visit. In a pass with
     * stored edges (`IncrementalShadow.storedWalk`), a clean module does not
     * build its plan: `IncrementalShadow.storedSteps` gives the steps of its
     * member list now, and the same `takeStep` applies them. The queue, the
     * order and `Module.addTypes` are the same code for both kinds of step,
     * so the walk with stored edges cannot drift from the live walk. A
     * stored step that cannot be taken exactly as recorded throws, and the
     * generator walks again with live edges only (see the caller).
     */
    function expandReachability(roots: Array<String>,
        kinds: Array<DependencyEdgeKind>, profile: String,
        recorded: Bool): Map<String, Bool> {
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

      // Applies one target step: adds the declaration to its module (or
      // makes the module), checks the member, and queues the module.
      // Returns true when the step added a declaration or a module: only
      // then did it read `resolve`. `typeName` is read only when no member
      // has the plain name, as before slice S2.
      function takeStep(step: WalkStep, typeName: Void->String,
          resolve: Void->Type, fail: String->Void): Bool {
        var target = modules.get(step.module);
        var changed = false;
        if (target == null) {
          addModule(step.module, [resolve()]);
          target = modules.get(step.module);
          changed = true;
        } else {
          changed = target.addDeclaration(step.name, typeName, resolve);
        }

        final hasMember = target.getMember(step.name) != null
          || target.getMember(typeName()) != null;
        if (!hasMember)
          fail('Genes DependencyPlan ($profile) retained '
            +
            '${step.key.substr(step.key.indexOf(":") + 1)} but could not materialize '
            + 'its emitted declaration');

        if (!reachable.exists(step.module))
          enqueue(step.module);
        else if (changed)
          pending.push(step.module);
        return changed;
      }

      var index = 0;
      while (index < pending.length) {
        final moduleName = pending[index++];
        IncrementalShadow.enter(moduleName, Reachability);
        final sourceModule = modules.get(moduleName);
        if (sourceModule == null)
          CompilerDiagnostic.fail('Genes DependencyPlan ($profile): missing source module '
            + moduleName,
            Context.currentPos());

        // The member list when the visit starts: a step of this visit can
        // add a declaration to this module itself.
        final state = recorded ? IncrementalShadow.memberState(sourceModule.members) : null;
        final stored = state == null ? null : IncrementalShadow.storedSteps(moduleName,
          state);
        if (stored != null) {
          for (position => step in stored.steps) {
            IncrementalShadow.checkStoredTarget(moduleName, step,
              stored.targets == null ? null : stored.targets[position]);
            final resolve = () -> IncrementalShadow.resolveStoredStep(step,
              stored.stamps[position]);
            takeStep(step,
              () ->
                step.typeName.length > 0 ? step.typeName : TypeUtil.baseTypeName(TypeUtil.typeToBaseType(resolve())),
              resolve, IncrementalShadow.leaveRecordedPath);
          }
          continue;
        }

        final visitSteps: Array<WalkStep> = [];
        // The text of the target facts of each step's declaration
        // (`WalkTarget.inputsText`), which this walk and the plan read
        // before a step; see `GenerationCache.CachedVisit`.
        final visitTargets: Array<String> = [];
        final resolvedKeys: Array<String> = [];
        final namedKeys: Array<String> = [];
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

          // The walk reads the target only through `WalkTarget.inputsOf`,
          // and records the text of those facts with the step, so the walk
          // with stored edges compares every fact that this decision reads
          // (`IncrementalShadow.checkStoredTarget`). Abstracts erase or
          // project through their backing type and never own an emitted
          // member; externs, type parameters and `StdTypes` get no step.
          final inputs = WalkTarget.inputsOf(referencedType);
          if (!WalkTarget.takesStep(inputs))
            continue;
          final targetModule = switch inputs.module {
            case null | '':
              CompilerDiagnostic.fail('Genes DependencyPlan ($profile) cannot resolve '
                + '${inputs.name} to an output module '
                + '[${edge.provenance.rule}]',
                edge.provenance.sourcePosition);
            case module: module;
          }

          // The key is the declaration's identity: its kind and full name.
          final base = DependencyPlan.moduleTypeBase(referencedType);
          final key = DependencyPlan.moduleTypeKeyOf(referencedType, base);
          var typeName: Null<String> = null;
          final readTypeName = () -> {
            final known = typeName;
            if (known != null)
              return known;
            final name = TypeUtil.baseTypeName(base);
            typeName = name;
            return name;
          };
          final changed = takeStep({
            key: key,
            module: targetModule,
            name: inputs.name,
            typeName: ''
          },
            readTypeName,
            () -> DependencyPlan.moduleTypeToType(referencedType),
            (message: String) -> {
              CompilerDiagnostic.fail('$message [${edge.provenance.rule}]',
                edge.provenance.sourcePosition);
              return;
            });
          if (state != null) {
            // The second name is stored only when this walk read it; an
            // empty text makes the stored walk read it from the declaration.
            final known = typeName;
            visitSteps.push({
              key: key,
              module: targetModule,
              name: inputs.name,
              typeName: known == null ? '' : known
            });
            visitTargets.push(WalkTarget.inputsText(inputs));
            if (changed)
              resolvedKeys.push(key);
            if (known != null)
              namedKeys.push(key);
          }
        }
        if (state != null)
          IncrementalShadow.recordVisit(moduleName, state, visitSteps,
            visitTargets, resolvedKeys, namedKeys);
      }
      IncrementalShadow.enter(null, Reachability);
      return reachable;
    }

    final endReachabilityTimer = planTimer('genes.plan.reachability');
    #if genes.compile_stage_profile
    final endReachabilityRootsTimer = planTimer('genes.plan.reachability.roots');
    #end
    final initialNames = [for (name in modules.keys()) name];
    initialNames.sort(Reflect.compare);
    final explicitlyExposedModules = new Map<String, Bool>();
    for (item in expose)
      explicitlyExposedModules.set(item.module, true);
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
    #if genes.compile_stage_profile
    endReachabilityRootsTimer();
    final endReachabilityExpandTimer = planTimer('genes.plan.reachability.expand');
    #end
    // Stage 3, slice S2. In a pass with stored edges
    // (`IncrementalShadow.storedWalk`: `generation` "compare" or "reuse"
    // with a usable cache), each clean module takes the steps that were
    // recorded for its member list instead of building its dependency plan,
    // and answers the import-cycle questions of other modules from its
    // stored runtime requests. When a stored step cannot be taken exactly as
    // recorded, or a check of `planReplay` fails, the generator leaves this
    // pass before any `api.addFeature` and generates again with live edges
    // and no clean module: `generateTransactional` runs once more from the
    // start, with new `Module` values. "compare" always runs that second,
    // live pass and compares the two walks.
    final storedPass = IncrementalShadow.storedWalk();
    var reachabilityTimersOpen = true;
    function endReachabilityTimers(): Void {
      if (!reachabilityTimersOpen)
        return;
      reachabilityTimersOpen = false;
      #if genes.compile_stage_profile
      endReachabilityExpandTimer();
      #end
      endReachabilityTimer();
    }
    var implementationNames: Array<String> = [];
    var replayed = new Map<String, Bool>();
    try {
      final implementationReachable = expandReachability(implementationRoots,
        implementationKinds, tsMode ? 'ts-strict' : 'classic-esm', true);
      implementationNames = [
        for (name in implementationReachable.keys())
          name
      ];
      implementationNames.sort(Reflect.compare);
      endReachabilityTimers();
      if (IncrementalShadow.comparesWalks())
        IncrementalShadow.walkResult(implementationNames, modules);
      if (storedPass)
        for (name in implementationNames) {
          final requests = IncrementalShadow.storedRuntimeRequests(name);
          if (requests != null)
            modules.get(name).replayRuntimeRequests(requests);
        }

      // Stage 3, slice S1. With `generation: "reuse"` this returns the clean
      // modules whose stored output this request stages instead of validating
      // and printing them; otherwise (and without the define) it is empty. The
      // checks run here, after the walk and before the first module is
      // printed, so a fallback is decided before any `api.addFeature`.
      replayed = IncrementalShadow.planReplay(implementationNames, name -> {
        final module = modules.get(name);
        final implementation = (tsMode && module.path != 'StdTypes'
          && hasImplementation(module))
          || (!tsMode && hasClassicImplementation(module));
        final exposed = explicitlyExposedModules.exists(name);
        {
          emits: implementation,
          members: genes.incremental.ModuleFingerprint.members(module.members,
            IncrementalShadow.listed),
          rootFlags: IncrementalShadow.rootFlags(tsMode ? isTypedImplementationRoot(module,
            exposed) : needsGen(module),
            exposed, module.expose.length, implementation)
        };
      }, {
        feature: api.hasFeature,
        moduleExists: name -> modules.exists(name),
        cycle: (asker, test) -> {
          final module = modules.get(asker);
          module != null
          && module.isCyclic(test);
        },
        signatureFact: genes.ts.SignatureCache.factAnswer,
        reactRefreshSplit: (name, _) -> {
          final module = modules.get(name);
          ReactRefreshModulePlan.answerText(module == null ? null : module.reactRefreshComponents());
        }
      });
    } catch (error:haxe.Exception) {
      endReachabilityTimers();
      endRerunTimer();
      if (!storedPass)
        throw error;
      // Any stop of the pass with stored edges is a fallback, never a
      // diagnostic: the live pass reports a real error again.
      IncrementalShadow.leaveStoredPass(error.message);
      generateTransactional(api, outputFile, output, outputTransaction,
        programFacts);
      return;
    }
    endRerunTimer();
    if (storedPass && IncrementalShadow.walkAgain()) {
      generateTransactional(api, outputFile, output, outputTransaction,
        programFacts);
      return;
    }

    final endValidationTimer = timer('genes.validate.modules');
    final jsxCapability = JsxCapabilityPolicy.current();
    // Validate every reachable module before an emitter opens its buffered
    // writer. Capability failures therefore cannot leave a mixed output tree.
    // A replayed module passed both loops in the request that printed it,
    // with the same inputs (the clean rules and the checks of `planReplay`).
    final endJsxValidationTimer = timer('genes.validate.jsx');
    for (name in implementationNames) {
      if (replayed.exists(name))
        continue;
      IncrementalShadow.enter(name, Validation);
      final module = modules.get(name);
      jsxCapability.validate(module.jsxPlan);
      // Resolve the edge here as well as in emitters so alias/capability
      // failures are diagnosed before any module writer is opened.
      jsxCapability.resolveRuntimeBinding(module.codeDependencies,
        module.jsxPlan);
    }
    IncrementalShadow.enter(null, Validation);
    endJsxValidationTimer();
    // Public module functions must not force ModuleFunctionPlan ahead of other
    // semantic plans: a malformed template/JSX carrier owns the earlier source
    // diagnostic. Once every reachable module has passed those checks, collect
    // validated public bindings before any emitter opens a staged writer.
    final endDirectBindingValidationTimer = timer('genes.validate.directBindings');
    final outputModule = modules.get(output);
    for (moduleName in implementationNames) {
      if (replayed.exists(moduleName)) {
        // The stored entries, in their stored order: the root module's export
        // list is the same as in a full generation.
        for (entry in IncrementalShadow.storedPublicEntries(moduleName)) {
          final publicExport = {
            name: entry.name,
            pos: entry.pos,
            isType: false,
            module: moduleName
          };
          export(publicExport);
          outputModule.expose.push(publicExport);
        }
        continue;
      }
      IncrementalShadow.enter(moduleName, Validation);
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
        IncrementalShadow.publicEntry(moduleName, publicName,
          entry.requestedPos);
        export(publicExport);
        outputModule.expose.push(publicExport);
      }
    }
    IncrementalShadow.enter(null, Validation);
    endDirectBindingValidationTimer();
    endValidationTimer();

    final endImplementationTimer = timer('genes.emit.implementation');
    for (name in implementationNames) {
      final module = modules.get(name);
      // `StdTypesEmitter` owns the canonical TS support module. The ordinary
      // typed module used to be emitted first and then overwritten, leaving an
      // orphan source map for text that no longer existed.
      if (tsMode && module.path == 'StdTypes')
        continue;
      if ((tsMode && hasImplementation(module))
        || (!tsMode && hasClassicImplementation(module))) {
        if (replayed.exists(name)) {
          // Stage the stored files, report the stored warnings and add the
          // stored features at this module's place in the sorted order.
          IncrementalShadow.replay(name, outputDir, outputTransaction,
            api.hasFeature, api.addFeature);
          continue;
        }
        IncrementalShadow.enter(name, Emit);
        generateImplementation(api, module, outputDir, outputTransaction);
        // Stage 3, slice S2: the runtime requests of the printed module. A
        // later request with stored edges answers import-cycle questions
        // about the module from them while it is clean (`Module.isCyclic`).
        if (IncrementalShadow.recording())
          IncrementalShadow.recordRuntimeRequests(name,
            module.internalRuntimeRequests());
      }
    }
    IncrementalShadow.enter(null, Emit);
    endImplementationTimer();

    if (tsMode) {
      final endSupportTimer = timer('genes.emit.tsSupport');
      final stdTypesPath = Path.join([outputDir, 'StdTypes'])
        + Genes.outExtension;
      // The normal manifest diff retires source maps produced by an older
      // Genes build. A historical filename alone is not ownership evidence:
      // the output directory may also contain a user-created file with that
      // name, so first builds must leave it untouched.
      StdTypesEmitter.emit(stdTypesPath, outputTransaction);
      endSupportTimer();
    }

    #if dts
    // Declaration expansion happens after executable output is complete. A
    // declaration-only type can therefore never broaden classic JS DCE or alter
    // a TS implementation module merely by being reachable from public types.
    final endDeclarationPlanTimer = timer('genes.plan.declarations');
    final declarationReachable = expandReachability(implementationNames,
      [DeclarationOnly], 'classic-dts', false);
    final declarationNames = [
      for (name in declarationReachable.keys())
        name
    ];
    declarationNames.sort(Reflect.compare);
    endDeclarationPlanTimer();
    final endDeclarationTimer = timer('genes.emit.declarations');
    for (name in declarationNames)
      generateDefinition(api, modules.get(name), outputDir, outputTransaction);
    endDeclarationTimer();
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
    final endPublicationTimer = timer('genes.publish.transaction');
    outputTransaction.commit();
    endPublicationTimer();
    // Stage 3, the rolling replay audit (genes-f8vc.9.23): with
    // `generation: "reuse"`, print a few replayed modules again into memory
    // and compare them with what this request replayed. It runs after this
    // transaction committed, but before the request returns: a development
    // session that publishes the candidate afterwards waits for it.
    // Without a replayed module this list is empty.
    final audited = IncrementalShadow.auditCandidates();
    if (audited.length > 0) {
      final endAuditTimer = timer('genes.audit.replay');
      // The new print must not change this request's feature flags.
      final auditApi: JSGenApi = {
        outputFile: api.outputFile,
        types: api.types,
        main: api.main,
        generateStatement: api.generateStatement,
        generateValue: api.generateValue,
        setTypeAccessor: api.setTypeAccessor,
        isKeyword: api.isKeyword,
        addFeature: _ -> true,
        hasFeature: api.hasFeature,
        quoteString: api.quoteString,
        buildMetaData: api.buildMetaData,
        setCurrentClass: api.setCurrentClass
      };
      final scratch = OutputTransaction.scratch(outputDir,
        Path.withoutDirectory(Path.normalize(outputFile)));
      for (name in audited) {
        final module = modules.get(name);
        IncrementalShadow.auditModule(name, scratch, () -> {
          // The same checks and the same print as for a module that is not
          // replayed (the two validation loops and the emission loop above).
          jsxCapability.validate(module.jsxPlan);
          jsxCapability.resolveRuntimeBinding(module.codeDependencies,
            module.jsxPlan);
          for (entry in module.moduleFunctionPlan.rootPublicEntries()) {
            final publicName = entry.publicExportName;
            if (publicName != null)
              IncrementalShadow.publicEntry(name, publicName,
                entry.requestedPos);
          }
          generateImplementation(auditApi, module, outputDir, scratch);
        });
      }
      endAuditTimer();
    }
    // Stage 3: compare and store only after the complete tree is public, so
    // a failed request keeps the cache of the last successful generation.
    IncrementalShadow.committed();
    // With `"moduleRecords": true`, keep the facts that a later module
    // request checks (G3); otherwise this returns at once.
    final endRecordsTimer = timer('genes.records.store');
    ModuleRequest.programCommitted(api.types, api.main, outputFile);
    endRecordsTimer();
  }

  /**
   * Prints only `target` for a module request (G3) and publishes its files
   * when `ModuleRequest.decide` proves that they equal the files of a full
   * request; otherwise publishes nothing. Either way it writes the module
   * request report.
   *
   * Why: a full request plans and prints every reachable module, about 90%
   * of a request after one edit. A development session wants to show the
   * edited module first.
   *
   * What/How: the inventory, the walk of reachability, validation and
   * printing run as in `generateTransactional`, but for `target` only: the
   * walk follows the edges of `target` one step, so that the modules that
   * it imports exist with the declarations that it names, and does not plan
   * them. The output root gets no export list, and no TypeScript support
   * file is printed. The checks then compare the result with the stored
   * records: those of the last full request, advanced by the previews
   * published since (genes-f8vc.14.8); see `ModuleRequest` for the rules and
   * limits. After a published preview, the records of `target` advance to
   * what a full request stores for these sources
   * (`ModuleRequest.previewCommitted`, with the entry of
   * `IncrementalShadow.previewEntry`).
   */
  static function generateModuleRequest(haxeApi: JSGenApi, outputFile: String,
      output: String, outputTransaction: OutputTransaction,
      target: String): Void {
    final started = haxe.Timer.stamp();
    final endRootsTimer = timer('genes.module.roots');
    // The roots of dead-code elimination must not reach any printer.
    ModuleRequest.removeRoots();
    endRootsTimer();
    // The program of this request is only a part of the full program: answer
    // feature questions as a full build would (`featureAnswer`). Every other
    // function is Haxe's own.
    final api: JSGenApi = {
      outputFile: haxeApi.outputFile,
      types: haxeApi.types,
      main: haxeApi.main,
      generateStatement: haxeApi.generateStatement,
      generateValue: haxeApi.generateValue,
      setTypeAccessor: haxeApi.setTypeAccessor,
      isKeyword: haxeApi.isKeyword,
      addFeature: haxeApi.addFeature,
      hasFeature: feature -> ModuleRequest.featureAnswer(feature,
        haxeApi.hasFeature(feature)),
      quoteString: haxeApi.quoteString,
      buildMetaData: haxeApi.buildMetaData,
      setCurrentClass: haxeApi.setCurrentClass
    };
    final endInventoryTimer = timer('genes.plan.inventory');
    TypeUtil.startGenerationNames();
    ModuleDirectivePlan.validate();
    // The member lists of this request are compared with the stored ones,
    // which name the declarations of the generator's list
    // (`IncrementalShadow.listed`).
    IncrementalShadow.listPreview(api.types);
    final toGenerate = typesPerModule(api.types);
    final extension = Path.extension(outputFile);
    final outputDir = Path.directory(outputFile);
    Genes.outExtension = extension.length > 0 ? '.$extension' : extension;
    final concrete = [];
    for (type in api.types)
      switch type {
        case TEnum((_.get() : BaseType) => t, _) |
          TInst((_.get() : BaseType) => t, _):
          concrete.push(TypeUtil.baseTypeFullName(t));
        default:
      }
    final modules = new Map<String, Module>();
    final context: genes.Module.ModuleContext = {
      concrete: concrete,
      modules: modules,
      hasFeature: api.hasFeature,
      jsxProviderSchemas: new genes.JsxTypeChecker.JsxProviderSchemaCatalog(),
      explicitTypeArgumentDeclarations: new genes.ExplicitTypeArguments.ExplicitTypeArgumentDeclarations(),
      jsonTypeDefinitions: new genes.JsonTypeSupport.JsonTypeDefinitionAnswers()
    }
    function typesOf(name: String): Array<Type>
      return switch toGenerate.get(name) {
        case null: [];
        case v: v;
      }
    final own = toGenerate.get(target);
    final endReferencesTimer = timer('genes.module.references');
    final declarations = ModuleRequest.typesOf(api.types, target);
    final references = ModuleRequest.referencesOf(target, declarations);
    endReferencesTimer();
    var module: Null<Module> = null;
    var exposed = false;
    var emits = false;
    if (own != null && target != output) {
      for (type in own)
        switch type {
          #if (haxe_ver >= 4.2)
          case TInst(ownerRef, _)
            if (ownerRef.get().kind.match(KModuleFields(_))):
            for (field in ownerRef.get().statics.get())
              if (field.meta.has(':expose'))
                exposed = true;
          #end
          default:
            final base = TypeUtil.typeToBaseType(type);
            if (base != null
              && (base.meta.has(':expose') || LibraryProfile.isRoot(base)))
              exposed = true;
        }
      modules.set(output,
        new Module(context, output, typesOf(output), api.main, []));
      IncrementalShadow.enter(target, Inventory);
      final planned = new Module(context, target, own);
      modules.set(target, planned);
      // A full request has a `Module` for every module of the program before
      // planning starts, and planning asks whether a module is in that map
      // (`Module.resolveModuleFunction`). Give each module that the target
      // uses its `Module` here, with its declarations of this request.
      for (name in references.modules)
        if (!modules.exists(name) && toGenerate.exists(name))
          modules.set(name, new Module(context, name, typesOf(name)));
      IncrementalShadow.enter(null, Inventory);
      module = planned;
    }
    endInventoryTimer();
    // The step targets of the module's edges, for the `-dce std` rule of
    // `ModuleRequest.decide` (`<module>|<declaration key>`).
    final requestSteps = new Map<String, Bool>();
    if (module != null) {
      final endReachabilityTimer = timer('genes.plan.reachability');
      // One step of the walk of `generateTransactional`: the targets of the
      // module's edges get the declarations that it names, with the
      // declarations of their own module first, as in a full request.
      final kinds = [RuntimeValue, RuntimeSideEffect, TypeOnly];
      IncrementalShadow.enter(target, Reachability);
      var again = true;
      while (again) {
        again = false;
        // Each pass is one visit of the module, recorded as the walk of a
        // full request records it (`IncrementalShadow.recordVisit`, keyed by
        // the member list when the visit starts), so that an accepted preview
        // can store the visits of a full request (genes-f8vc.14.8). As in
        // that walk, a step that adds a declaration to the module itself
        // does not end the visit: the visit takes the rest of its edges, and
        // the module is visited again with the new member list.
        final state = IncrementalShadow.memberState(module.members);
        final visitSteps: Array<WalkStep> = [];
        final visitTargets: Array<String> = [];
        for (edge in module.dependencyPlan.edges) {
          if (!DependencyPlan.containsKind(kinds, edge.kind))
            continue;
          switch edge.importSpec {
            case Bound(importSpec) if (importSpec.external):
              continue;
            case SideEffect(edgeRequest) if (edgeRequest.external):
              continue;
            default:
          }
          final referencedType = edge.referencedType;
          if (referencedType == null) {
            if (edge.importSpec != null)
              CompilerDiagnostic.fail('Genes DependencyPlan (module request) has an internal '
                + 'import without a typed declaration '
                + '[${edge.provenance.rule}]',
                edge.provenance.sourcePosition);
            continue;
          }
          // The same step decision as the walk of a full request: the
          // target is read only through `WalkTarget.inputsOf`.
          final inputs = WalkTarget.inputsOf(referencedType);
          if (!WalkTarget.takesStep(inputs))
            continue;
          final moduleName = switch inputs.module {
            case null | '':
              CompilerDiagnostic.fail('Genes DependencyPlan (module request) cannot resolve '
                + '${inputs.name} to an output module '
                + '[${edge.provenance.rule}]',
                edge.provenance.sourcePosition);
            case name: name;
          }
          final base = DependencyPlan.moduleTypeBase(referencedType);
          final key = DependencyPlan.moduleTypeKeyOf(referencedType, base);
          requestSteps.set('$moduleName|$key', true);
          var targetModule = modules.get(moduleName);
          // A full request has a `Module` for each module of the generator's
          // list before the walk; another module exists only after a step
          // made it, which depends on the order of the walk.
          final existed = targetModule != null
            || typesOf(moduleName).length > 0;
          if (targetModule == null) {
            targetModule = new Module(context, moduleName, typesOf(moduleName));
            modules.set(moduleName, targetModule);
          }
          // The walk of a full request reads the second name of a step, and
          // records it, when the target existed before the step without a
          // member of the plain name, or has none after it (`takeStep`).
          // When the target did not exist, a full request records it or not
          // by the order of its walk, so the records text leaves it out
          // (`GenerationCache.entryText`, review of genes-ts #268).
          var named = existed && targetModule.getMember(inputs.name) == null;
          final changed = targetModule.addTypes([DependencyPlan.moduleTypeToType(referencedType)]);
          if (targetModule.getMember(inputs.name) == null)
            named = true;
          if (targetModule.getMember(base.name) == null
            && targetModule.getMember(TypeUtil.baseTypeName(base)) == null)
            CompilerDiagnostic.fail('Genes DependencyPlan (module request) retained '
              + '${TypeUtil.baseTypeFullName(base)} but could not materialize '
              + 'its emitted declaration [${edge.provenance.rule}]',
              edge.provenance.sourcePosition);
          if (state != null) {
            visitSteps.push({
              key: key,
              module: moduleName,
              name: inputs.name,
              typeName: named ? TypeUtil.baseTypeName(base) : ''
            });
            visitTargets.push(WalkTarget.inputsText(inputs));
          }
          // The plan of the module itself changed: visit it again.
          if (changed && targetModule == module)
            again = true;
        }
        if (state != null)
          IncrementalShadow.recordVisit(target, state, visitSteps,
            visitTargets, [], []);
      }
      IncrementalShadow.enter(null, Reachability);
      endReachabilityTimer();

      final endValidationTimer = timer('genes.validate.modules');
      final jsxCapability = JsxCapabilityPolicy.current();
      IncrementalShadow.enter(target, Validation);
      jsxCapability.validate(module.jsxPlan);
      jsxCapability.resolveRuntimeBinding(module.codeDependencies,
        module.jsxPlan);
      for (entry in module.moduleFunctionPlan.rootPublicEntries())
        if (entry.publicExportName != null)
          exposed = true;
      IncrementalShadow.enter(null, Validation);
      endValidationTimer();

      emits = module.path != 'StdTypes' && hasImplementation(module);
      if (emits) {
        final endImplementationTimer = timer('genes.emit.implementation');
        IncrementalShadow.enter(target, Emit);
        generateImplementation(api, module, outputDir, outputTransaction);
        // As in a full request: the runtime requests of the printed module,
        // for the cache entry that an accepted preview stores.
        if (IncrementalShadow.recording())
          IncrementalShadow.recordRuntimeRequests(target,
            module.internalRuntimeRequests());
        IncrementalShadow.enter(null, Emit);
        endImplementationTimer();
      }
    }

    final checkStart = haxe.Timer.stamp();
    final endCheckTimer = timer('genes.module.check');
    final facts: genes.incremental.ModuleRequest.ModuleRequestFacts = {
      module: target,
      rootModule: output,
      types: module == null ? [] : declarations,
      allTypes: api.types,
      references: references,
      members: module == null ? '' : genes.incremental.ModuleFingerprint.members(module.members,
        IncrementalShadow.listed),
      rootFlags: module == null ? '' : IncrementalShadow.rootFlags(isTypedImplementationRoot(module,
        exposed), exposed,
        module.expose.length, emits),
      emits: emits,
      exposed: exposed,
      outputFolder: ModuleRequest.absoluteFolder(outputFile),
      hasMain: api.main != null,
      steps: {
        final list = [for (step in requestSteps.keys()) step];
        list.sort(Reflect.compare);
        list;
      },
      runtimeRequests: module == null ? [] : module.internalRuntimeRequests()
    };
    final refusal = ModuleRequest.decide(facts);
    endCheckTimer();
    final checkSeconds = haxe.Timer.stamp() - checkStart;
    final files = IncrementalShadow.recordedModule(target).files;
    final kept = ModuleRequest.keptLines(declarations).length;
    if (refusal != null) {
      outputTransaction.abort();
      // Leave no file of an earlier preview in the folder: publish an empty
      // tree, but only into a folder that is not the program's.
      if (ModuleRequest.mayEmptyFolder(ModuleRequest.absoluteFolder(outputFile),
        api.main != null))
        new OutputTransaction(Path.directory(outputFile),
          Path.withoutDirectory(Path.normalize(outputFile))).commit();
      IncrementalShadow.committed();
      ModuleRequest.writeReport(target,
        refusal.code == 'off' ? 'off' : 'refused', refusal, [], kept,
        haxe.Timer.stamp() - started, checkSeconds);
      return;
    }
    final endPublicationTimer = timer('genes.publish.transaction');
    outputTransaction.commit();
    endPublicationTimer();
    ModuleRequest.markPreviewFolder(ModuleRequest.absoluteFolder(outputFile));
    // genes-f8vc.14.8: the preview is published, so its module's records
    // advance to what a full request stores for these sources. The entry is
    // made while the shadow still holds what this request recorded.
    final endRecordsTimer = timer('genes.records.advance');
    final entry = IncrementalShadow.previewEntry(target, api.types,
      facts.members, facts.rootFlags);
    IncrementalShadow.committed();
    ModuleRequest.previewCommitted(facts, entry);
    endRecordsTimer();
    ModuleRequest.writeReport(target, 'preview', null, files, kept,
      haxe.Timer.stamp() - started, checkSeconds);
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
   * Returns true when Haxe gives `cls` an `__rtti` string: the class or one of
   * its parent classes has `@:rtti`.
   *
   * Why: Haxe 4.3.7 prints the class metadata into `__rtti`
   * (`filters.ml`, `add_rtti`) after the `onGenerate` callbacks. The
   * `:genes.generate(N)` stamp would then be printed too, and `N` is the
   * request number of this macro interpreter: 1 in a cold build, another
   * number on a warm compilation server. The same source then gave different
   * output on a warm server.
   *
   * What/How: the TypeScript profile never reads the stamp (its roots come
   * from `isTypedImplementationRoot`), so it does not stamp such a class.
   * Removing the stamp later is not possible: Haxe prints `__rtti` after
   * dead-code elimination and before the custom generator runs, and the
   * classic profile reads the stamp in that generator (`needsGen`). The
   * classic profile therefore keeps the stamp, and its `__rtti` still holds
   * it; that remains a known warm/cold difference of classic `@:rtti` classes.
   */
  static function hasRuntimeTypeInfo(cls: ClassType): Bool {
    var current: Null<ClassType> = cls;
    while (current != null) {
      if (current.meta.has(':rtti'))
        return true;
      final parent = current.superClass;
      current = parent == null ? null : parent.t.get();
    }
    return false;
  }

  /**
   * Finds only the metadata pair needed to retain the compilation-root module.
   *
   * Why: an `@:expose` request must keep the root export alive even in a
   * library-only build with no `--main`. Haxe represents a genuine file-level
   * function on a synthetic `KModuleFields` class, so those owners must
   * participate in this shallow pre-DCE probe just like supported class static
   * methods.
   *
   * What/How: this deliberately checks only for the two annotations and does
   * not parse or validate either one. Full validation remains in
   * ModuleFunctionPlan after template/JSX planning, so retaining the root
   * cannot mask a more precise semantic diagnostic.
   */
  static function hasPublicModuleFunctionCandidate(module: Module): Bool {
    for (member in module.members) {
      switch member {
        case MClass(_, _, fields):
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
      RequestMeasure.generateDeclaration();
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
        var part: ReactRefreshPart = Whole;
        var fieldsEmitter: Null<TsModuleEmitter> = null;
        // The module records its own split too: a module request (G3) that
        // splits a module, or makes it one file again, must not keep the
        // published imports of the other modules.
        if (module.reactRefreshSplitOf(module.module) != null) {
          // The sibling holds every declaration except the components. It is
          // written first, so the component file knows what to import.
          final fieldsPath = ReactRefreshModulePlan.fieldsPath(Path.join([outputDir, module.path]),
            Genes.outExtension);
          fieldsEmitter = new TsModuleEmitter(module.createContext(api),
            outputTransaction.writer(fieldsPath));
          fieldsEmitter.deferJsxConsumptionValidation();
          fieldsEmitter.emitTsModule(module, importExtension, Fields);
          #if (debug || js_source_map)
          fieldsEmitter.emitSourceMap(fieldsPath + '.map', true,
            outputTransaction);
          #end
          fieldsEmitter.finish();
          part = Components(fieldsEmitter.reactRefreshBindings());
        }
        final emitter = new TsModuleEmitter(ctx,
          outputTransaction.writer(path));
        if (fieldsEmitter != null)
          emitter.continueJsxConsumption(fieldsEmitter);
        emitter.emitTsModule(module, importExtension, part);
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
      if (!alreadyInstalled) {
        // Module requests (G3) only: Genes reads the source files before this
        // request types any module, also before the lookups below. Those
        // lookups type `genes.Register` and `js.Boot`, and a `@:build` or
        // `@:using` that an earlier init macro added to them can type a
        // project module (genes-v54c). The lookups stay eager on Haxe 4:
        // later lookups change generated code (see `refreshCompilerTypes`).
        // Neither module nor anything that they import reads
        // `genes.generator.active`, so defining it first changes no text.
        // The request measure starts first (only with a request
        // descriptor), with the hook boundaries of `measureHooks`.
        RequestMeasure.begin(genes.incremental.IncrementalRequest.requestedDescriptor() != null);
        if (RequestMeasure.active) {
          Context.onAfterTyping(_ -> RequestMeasure.mark('genes.after-typing'));
          Context.onGenerate(_ -> RequestMeasure.mark('genes.on-generate'));
        }
        ModuleRequest.begin();
        TypeUtil.refreshCompilerTypes();
      }
      isolateCompilerOutput(alreadyInstalled);
      LibraryProfile.validate();
      ReactRefreshModulePlan.validateProfile();
      // A second `Generator.use()` in one request must not register a second
      // capture: each module list would then hold every declaration twice.
      if (!alreadyInstalled) {
        TypedModuleInventory.install();
        // Module requests (G3) only; without the incremental define this
        // registers nothing. Registered here, after the other installers,
        // as before; `ModuleRequest.begin` above only read the files.
        ModuleRequest.install();
      }
      ModuleDirectivePlan.install();
      // TypeScript implementation output and classic declaration output both
      // need source-level signatures captured before runtime-oriented DCE.
      if (Context.defined('genes.ts') || Context.defined('dts')
        || LibraryProfile.isEnabled()) {
        genes.PublicSurface.install();
        genes.ts.SignatureCache.install();
      }
      Compiler.include('genes.Register');
      final typeScriptProfile = Context.defined('genes.ts');
      Context.onGenerate(types -> {
        generation++;
        // A module request (G3) runs only on the TypeScript profile, which
        // never reads the stamp; skip the loop over every declaration.
        if (ModuleRequest.skipsGenerationStamps())
          return;
        final pos = Context.currentPos();
        for (type in types) {
          RequestMeasure.generateDeclaration();
          switch type {
            case TInst(_.get() => cls, _)
              if (typeScriptProfile && hasRuntimeTypeInfo(cls)):
              // See `hasRuntimeTypeInfo`: the stamp would reach `__rtti`.
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
      if (!alreadyInstalled)
        measureHooks();
    }
    #end
  }

  /**
   * Registers the last hook boundaries of the request measure
   * (`RequestMeasure`), after every other Genes hook of `use()`; without a
   * request descriptor it registers nothing.
   *
   * Why: the phases of the measure must add up to the request, so that a
   * report shows which part of its CPU time no phase names. Haxe runs the
   * callbacks of one hook in the order of registration. The phases then
   * follow Haxe's order: `genes.init` (this init macro), `haxe.typing`,
   * `genes.after-typing` (the after-typing callbacks), `haxe.filters`,
   * `genes.on-generate` (the callbacks before and after Haxe saves the class
   * state, `ModuleRequest.afterSave` included), `haxe.dce` (dead-code
   * elimination and the filters after it) and `genes.generate`. A
   * callback of another macro that runs inside one of those spans counts
   * in it.
   */
  static function measureHooks(): Void {
    if (!RequestMeasure.active)
      return;
    RequestMeasure.mark('haxe.typing');
    Context.onAfterTyping(_ -> RequestMeasure.mark('haxe.filters'));
    // As `ModuleRequest.install`: a callback registered from inside a first
    // after-save callback runs after the ones registered before, so this
    // runs after `ModuleRequest.afterSave`.
    Context.onGenerate(_ -> Context.onGenerate(_ ->
      RequestMeasure.mark('haxe.dce'), false),
      false);
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

    final descriptorRead = readOutputDescriptor();
    final overridePresent = Context.defined(OUTPUT_DEFINE)
      || Context.defined(OUTPUT_DESCRIPTOR_DEFINE);
    final overrideValue = switch descriptorRead {
      case null: Context.definedValue(OUTPUT_DEFINE);
      case Right(path): path;
      case Left(_): null;
    }
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
        validateOutputDescriptor(descriptorRead);
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
    validateOutputDescriptor(descriptorRead);
    validateConfiguredOutput(requestedOutput);
    configuredOutputFile = requestedOutput;
    configuredOutputOverridePresent = Context.defined(OUTPUT_DEFINE);
    configuredOutputOverride = Context.definedValue(OUTPUT_DEFINE);
    configuredOutputDescriptor = Context.definedValue(OUTPUT_DESCRIPTOR_DEFINE);
    configuredTypeScriptProfile = Context.defined('genes.ts');
  }

  /**
   * Returns the output path that `-D genes.output_descriptor` names, the
   * reason why it cannot be read, or `null` when the define is absent.
   *
   * Why: the define value is only the path of the descriptor, so that it
   * stays the same for every request of a development session (see
   * `OUTPUT_DESCRIPTOR_DEFINE`). The path of this request is in the file.
   * The answer is a value, not an error: `isolateCompilerOutput` must first
   * move Haxe's own output to the private sentinel, and then reports the
   * error through `validateOutputDescriptor`.
   *
   * Example file: `genes.output-descriptor-v1`, a newline, and the base64
   * text of `/project/.genes/dev/candidates/revision-3-ab/output/index.tsx`.
   */
  static function readOutputDescriptor(): Null<haxe.ds.Either<String, String>> {
    if (!Context.defined(OUTPUT_DESCRIPTOR_DEFINE))
      return null;
    if (Context.defined(OUTPUT_DEFINE))
      return Left('-D $OUTPUT_DEFINE and -D $OUTPUT_DESCRIPTOR_DEFINE must not '
        + 'both be set');
    final file = Context.definedValue(OUTPUT_DESCRIPTOR_DEFINE);
    if (file == null
      || file == '1'
      || file.trim().length == 0
      || file.indexOf('\x00') >= 0)
      return Left('-D $OUTPUT_DESCRIPTOR_DEFINE=<path> requires the path of a '
        + 'descriptor file');
    if (!FileSystem.exists(file) || FileSystem.isDirectory(file))
      return Left('the descriptor file "$file" does not exist');
    final text = try sys.io.File.getContent(file) catch (_:haxe.Exception)
      return Left('the descriptor file "$file" cannot be read');
    final lines = text.split('\n');
    if (lines.length != 3 || lines[0] != OUTPUT_DESCRIPTOR_HEADER
      || lines[2] != '')
      return Left('the descriptor file "$file" is not a '
        + '$OUTPUT_DESCRIPTOR_HEADER file');
    final output = try haxe.crypto.Base64.decode(lines[1])
      .toString() catch (_:haxe.Exception) return
      Left('the descriptor file "$file" has no '
      + 'valid base64 output path');
    return Right(output);
  }

  /** Reports an output descriptor that cannot be used, after the sentinel redirect. */
  static function validateOutputDescriptor(read: Null<haxe.ds.Either<String,
    String>>): Void {
    switch read {
      case Left(reason):
        removeCompilerSentinel();
        Context.error('[GENES-OUTPUT-TARGET-005] $reason.',
          Context.currentPos());
      case null | Right(_):
    }
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
    final fromDescriptor = Context.defined(OUTPUT_DESCRIPTOR_DEFINE);
    if (!Context.defined(OUTPUT_DEFINE) && !fromDescriptor)
      return;
    // Haxe represents a valueless `-D name` as the string "1".
    if ((!fromDescriptor && output == '1') || output.trim().length == 0
      || output.indexOf('\x00') >= 0) {
      removeCompilerSentinel();
      Context.error('[GENES-OUTPUT-TARGET-001] '
        +
        (fromDescriptor ? 'The descriptor of -D $OUTPUT_DESCRIPTOR_DEFINE' : '-D $OUTPUT_DEFINE=<path>')
        + ' requires one explicit, non-empty output path.',
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
      final source = fromDescriptor ? 'The path "$output" in the descriptor of -D $OUTPUT_DESCRIPTOR_DEFINE' : '-D $OUTPUT_DEFINE="$output"';
      Context.error('[GENES-OUTPUT-TARGET-002] $source '
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
   * What/How: compare the two output defines and the `genes.ts` profile flag with
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
    final currentDescriptor = Context.definedValue(OUTPUT_DESCRIPTOR_DEFINE);
    final currentTypeScriptProfile = Context.defined('genes.ts');
    if (currentPresent == configuredOutputOverridePresent
      && currentValue == configuredOutputOverride
      && currentDescriptor == configuredOutputDescriptor
      && currentTypeScriptProfile == configuredTypeScriptProfile) {
      return;
    }

    removeCompilerSentinel();
    Context.error('[GENES-OUTPUT-TARGET-003] -D $OUTPUT_DEFINE, '
      + '-D $OUTPUT_DESCRIPTOR_DEFINE and '
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
