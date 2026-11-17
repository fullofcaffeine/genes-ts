import genes.incremental.GenerationCache;
import genes.incremental.GenerationChangeSet;
import genes.incremental.IncrementalRequest;
import haxe.macro.Context;

/**
 * Checks rules of incremental generation on their own, with made-up inputs:
 * the output lines of the session key, the clean rule for a module without a
 * declaration stamp, the refusal of `"generation": "compare"` and `"reuse"`
 * without `"afterTyping": "reuse"`, and the rules that slice S1 added before
 * any replay (the items of the review of #243): same-object proofs (item 1),
 * "left the program" from the current request (item 3), sources inside the
 * folder where output paths part (item 4), rule 6 for modules without an
 * output file (item 6), and no replay from a cache of afterTyping
 * `"measure"` (item 7).
 *
 * Why: these are the three changes that the G2 design review requires
 * before stored output may be replayed. A request sequence shows only the
 * cases that Haxe can produce today. Haxe 4.3.7 gives every declaration to
 * the after-typing callback, also a type that a macro defines there, so no
 * real request has a generated module with an empty epoch list. The rule
 * must still hold if that changes, so this probe calls
 * `GenerationCache.decide` directly. Each case differs from a clean case in
 * one input.
 *
 * What: `check()` is an init macro. It reports a fatal error for the first
 * case with a wrong answer. When all cases pass it prints one line,
 * `clean-rule-probe:ok (<n> cases)`, which `yarn test:compiler-server:shadow`
 * requires. It changes the generation cache of its own compiler process
 * only; run it with `--no-output` in a new process.
 */
/** Optional inputs of `CleanRuleProbe.store`. */
private typedef StoreOptions = {
  final ?answers: Array<String>;
  final ?mapSources: Array<String>;
  final ?outputFolder: String;
  final ?underReuse: Bool;
}

/** Optional inputs of `CleanRuleProbe.facts`. */
private typedef FactOptions = {
  final ?absent: Array<String>;
  final ?proofs: Map<String, Null<String>>;
  final ?failures: Array<String>;
  final ?outputFolder: String;
}

class CleanRuleProbe {
  static inline final OUTPUT = '/p/cand/rev-3/output';
  static inline final KEY = 'probe session key';
  static inline final DIGEST = 'probe reserved names';
  static var cases = 0;

  public static function check(): Void {
    checkOutputLines();
    checkUnstamped();
    checkRefusal();
    checkReplayRules();
    checkEmissionFeatures();
    checkExcludedMetadata();
    checkMetadataFingerprint();
    Sys.println('clean-rule-probe:ok ($cases cases)');
  }

  /** Required change 1: no absolute output path in the session key. */
  static function checkOutputLines(): Void {
    final root = '/p';
    final first = GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-3-ab/output/index.tsx',
      root);
    expectText('candidate folder',
      'output-root ../../../../..\noutput-file index.tsx\n', first);
    expectText('sibling candidate folder keeps the lines', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-4-cd/output/index.tsx',
        root));
    expectDifferent('folder at another depth', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-4-cd/index.tsx',
        root));
    expectDifferent('other extension', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-3-ab/output/index.ts',
        root));
    expectDifferent('other file name', first,
      GenerationChangeSet.outputKeyLines('/p/.genes/dev/candidates/revision-3-ab/output/main.tsx',
        root));
    expectText('output folder is the project root',
      'output-root .\noutput-file index.tsx\n',
      GenerationChangeSet.outputKeyLines('/p/index.tsx', root));
    expectText('output outside the project root names the way back',
      'output-root ../../p\noutput-file index.tsx\n',
      GenerationChangeSet.outputKeyLines('/q/out/index.tsx', root));
    expectText('sibling folders outside the project root',
      GenerationChangeSet.outputKeyLines('/q/out/index.tsx', root),
      GenerationChangeSet.outputKeyLines('/q/out2/index.tsx', root));
  }

  /** Required change 2: a module with no observed declaration stamp is never clean. */
  static function checkUnstamped(): Void {
    final epochs = [
      'app.Clean' => 'class:app.Clean@n:1',
      'app.Unstamped' => '',
      'app.Reader' => 'class:app.Reader@n:1',
      'app.Index' => 'class:app.Index@n:1'
    ];
    final fingerprints = [
      'app.Clean' => 'f-clean',
      'app.Unstamped' => 'f-unstamped',
      'app.Reader' => 'f-reader',
      'app.Index' => 'f-index'
    ];
    store(epochs, fingerprints, [], ['app.Reader' => ['app.Unstamped']]);
    final decision = GenerationCache.decide(facts(epochs, fingerprints));
    switch decision {
      case Rules(clean, dirty):
        expectState('stamped module with equal epochs', true, clean, dirty,
          'app.Clean', null);
        // Both epoch lists are empty, so their texts are equal. Before the
        // rule, this module was clean.
        expectState('module with no declaration stamp, both lists empty',
          false, clean, dirty, 'app.Unstamped', 'no declaration stamp');
        expectState('module that read an unstamped module by name', false,
          clean, dirty, 'app.Reader',
          'read app.Unstamped by name, and it changed or has no declaration stamp');
      default:
        fail('unstamped module', 'Rules', Std.string(decision));
    }
    // An unstamped module whose fingerprint changed: nothing says that Haxe
    // did not type it again, so rule 6 falls back as for a kept module.
    final changed = fingerprints.copy();
    changed.set('app.Unstamped', 'f-unstamped-2');
    switch GenerationCache.decide(facts(epochs, changed)) {
      case Fallback(_):
        cases++;
      case other:
        fail('unstamped module with a changed fingerprint', 'Fallback',
          Std.string(other));
    }
    // A module that had a stamp, has none now and is absent from the
    // generator list left the program (the last use of a type, a deleted
    // module). It is dirty, and its changed fingerprint must not make the
    // whole request fall back (item 3: decided from this request).
    final stored = epochs.copy();
    stored.set('app.Gone', 'class:app.Gone@n:1');
    final storedFingerprints = fingerprints.copy();
    storedFingerprints.set('app.Gone', 'f-gone');
    store(stored, storedFingerprints, [], []);
    switch GenerationCache.decide(facts(epochs, fingerprints)) {
      case Rules(clean, dirty):
        expectState('module that left the program', false, clean, dirty,
          'app.Gone', 'left the program');
      case other:
        fail('module that left the program', 'Rules', Std.string(other));
    }
    // A read outside any module, of a module without a stamp.
    store(epochs, fingerprints, ['app.Unstamped'], []);
    switch GenerationCache.decide(facts(epochs, fingerprints)) {
      case Fallback(_):
        cases++;
      case other:
        fail('read outside any module of an unstamped module', 'Fallback',
          Std.string(other));
    }
    GenerationCache.drop();
  }

  /** Required change 3: compare needs `afterTyping: "reuse"`. */
  static function checkRefusal(): Void {
    expectRefusal('compare with reuse', null, CompareClean, Reuse);
    expectRefusal('compare with measure', 'compare-needs-after-typing-reuse',
      CompareClean, Measure);
    expectRefusal('compare with compare', 'compare-needs-after-typing-reuse',
      CompareClean, Compare);
    expectRefusal('measure with measure', null, MeasureClean, Measure);
    expectRefusal('no generation value', null, Regenerate, Measure);
    expectRefusal('reuse with reuse', null, ReuseClean, Reuse);
    expectRefusal('reuse with measure', 'reuse-needs-after-typing-reuse',
      ReuseClean, Measure);
    expectRefusal('reuse with compare', 'reuse-needs-after-typing-reuse',
      ReuseClean, Compare);
  }

  /**
   * Every feature that a Genes emitter adds with a literal name
   * (`addFeature("...")`) must be in `GenerationCache.EMISSION_FEATURES`.
   *
   * Why: the checks before emission compare a clean module's feature
   * answers with the answers before the first module is printed. That is
   * exact only for features that no printing adds; a module that asked for
   * one of the others is never clean (rule 10). A new `addFeature` call that
   * is missing from the list would make that check unsound, so this case
   * reads the sources under `src/genes` and fails for it.
   */
  static function checkEmissionFeatures(): Void {
    final generator = Context.resolvePath('genes/Generator.hx');
    final root = haxe.io.Path.directory(sys.FileSystem.absolutePath(generator));
    final call = ~/addFeature\(\s*["']([^"']+)["']\s*\)/;
    var found = 0;
    for (file in haxeFiles(root)) {
      var text = sys.io.File.getContent(file);
      while (call.match(text)) {
        final feature = call.matched(1);
        found++;
        if (GenerationCache.EMISSION_FEATURES.indexOf(feature) < 0)
          fail('emission feature list',
            'addFeature("$feature") in $file to be ' +
            'in GenerationCache.EMISSION_FEATURES',
            'it is missing');
        text = call.matchedRight();
      }
    }
    cases++;
    if (found == 0)
      fail('emission feature list',
        'at least one addFeature call under $root', 'none');
  }

  /**
   * The metadata names that the fingerprint leaves out
   * (`ModuleFingerprint.EXCLUDED_META`) must not be read by any Genes source
   * outside `genes.incremental`, except by the readers that the reason
   * names. Today only `:genes.generate` has one: `Generator.needsGen`, on the
   * classic path, which incremental generation never serves.
   *
   * Why: a left-out name that an emitter reads would let a module's output
   * change without a fingerprint change (review of #244, round 2, N1).
   */
  static function checkExcludedMetadata(): Void {
    final allowed = [':genes.generate' => ['Generator.hx']];
    final generator = Context.resolvePath('genes/Generator.hx');
    final root = haxe.io.Path.directory(sys.FileSystem.absolutePath(generator));
    for (name => reason in genes.incremental.ModuleFingerprint.EXCLUDED_META) {
      cases++;
      if (reason.length == 0)
        fail('excluded metadata $name', 'a reason', 'none');
      final readers = allowed.exists(name) ? allowed.get(name) : [];
      for (file in haxeFiles(root)) {
        if (file.indexOf('/incremental/') >= 0
          || readers.indexOf(haxe.io.Path.withoutDirectory(file)) >= 0)
          continue;
        final text = sys.io.File.getContent(file);
        if (text.indexOf("'" + name + "'") >= 0
          || text.indexOf('"' + name + '"') >= 0)
          fail('excluded metadata $name',
            'no reader outside genes.incremental', 'a reader in $file');
      }
    }
  }

  /**
   * Metadata with its arguments is part of the fingerprint
   * (`ModuleFingerprint.metaText`), as a set: each change of a name or an
   * argument on a field, a class, an enum constructor, an abstract or a
   * typedef changes the text; an entry added twice, in another order, or a
   * left-out name does not. The same holds for the fields of an extern-only
   * module (`ModuleFingerprint.ofExtern`, L1 of genes-f8vc.9.24) and for the
   * fields of anonymous structures in a typedef body and in class field
   * types (`ModuleFingerprint.anonymousText`, L2), for the fields of
   * anonymous structures in type-parameter constraints
   * and for the metadata of a type parameter itself, also one that a
   * structure field declares (M3 of the cross-model review of #246)
   * (`ModuleFingerprint.constraintText`, L5 of genes-f8vc.9.26 and M1 of
   * the review of #246), and for a
   * member that the walk adds late, in the final member list
   * (`ModuleFingerprint.members`, L6). The cases change the
   * metadata of fixture types
   * in this compiler process only (the probe runs with `--no-output`) and
   * remove it again.
   */
  static function checkMetadataFingerprint(): Void {
    final pos = Context.currentPos();
    final arg = (text: String) -> [
      {
        expr: haxe.macro.Expr.ExprDef.EConst(CString(text, DoubleQuotes)),
        pos: pos
      }
    ];
    function cycleText(name: String, print: () -> String,
        meta: haxe.macro.Type.MetaAccess): Void {
      final before = print();
      meta.add(':probe.mark', arg('a'), pos);
      final marked = print();
      expectDifferent('$name: metadata added', before, marked);
      meta.add(':probe.mark', arg('a'), pos);
      expectText('$name: the same entry twice', marked, print());
      meta.remove(':probe.mark');
      meta.add(':probe.mark', arg('b'), pos);
      expectDifferent('$name: another argument', marked, print());
      meta.remove(':probe.mark');
      meta.add(':used', [], pos);
      expectText('$name: a left-out name', before, print());
      meta.remove(':used');
      expectText('$name: metadata removed again', before, print());
    }
    function cycle(name: String, type: haxe.macro.Type,
        meta: haxe.macro.Type.MetaAccess, ?externOnly: Bool): Void {
      cycleText(name,
        () ->
          externOnly == true ? genes.incremental.ModuleFingerprint.ofExtern([
          switch type {
            case TInst(ref, _):
              ref.get();
            default:
              throw 'an extern-only module holds classes only';
          }
        ]) : genes.incremental.ModuleFingerprint.of([type], [], []), meta);
    }
    final target = Context.getType('inc.MetaTarget');
    switch target {
      case TInst(ref, _):
        cycle('class', target, ref.get().meta);
        for (field in ref.get().statics.get())
          if (field.name == 'value')
            cycle('static field', target, field.meta);
      default:
        fail('metadata fingerprint', 'class inc.MetaTarget',
          Std.string(target));
    }
    final shape = Context.getType('inc.Shape');
    switch shape {
      case TEnum(ref, _):
        cycle('enum', shape, ref.get().meta);
        final circle = ref.get().constructs.get('Circle');
        if (circle == null)
          fail('metadata fingerprint', 'constructor inc.Shape.Circle', 'none');
        else
          cycle('enum constructor', shape, circle.meta);
      default:
        fail('metadata fingerprint', 'enum inc.Shape', Std.string(shape));
    }
    final color = Context.getType('inc.Color');
    switch color {
      case TAbstract(ref, _):
        cycle('abstract', color, ref.get().meta);
      default:
        fail('metadata fingerprint', 'abstract inc.Color', Std.string(color));
    }
    final bag = Context.getType('inc.Env.Bag');
    switch bag {
      case TType(ref, _):
        cycle('typedef', bag, ref.get().meta);
      default:
        fail('metadata fingerprint', 'typedef inc.Env.Bag', Std.string(bag));
    }
    // genes-f8vc.9.24, L1: the fields of an extern-only module.
    final api = Context.getType('inc.ExtApi');
    switch api {
      case TInst(ref, _):
        cycle('extern class', api, ref.get().meta, true);
        for (field in ref.get().statics.get())
          if (field.name == 'parseInt')
            cycle('extern static field', api, field.meta, true);
      default:
        fail('metadata fingerprint', 'extern class inc.ExtApi',
          Std.string(api));
    }
    // genes-f8vc.9.24, L2: the fields of anonymous structures, in a typedef
    // body and in each place of a class field type.
    function anonymousField(owner: String, type: haxe.macro.Type,
        name: String): Null<haxe.macro.Type.ClassField> {
      return switch type {
        case TAnonymous(ref):
          var found: Null<haxe.macro.Type.ClassField> = null;
          for (field in ref.get().fields)
            if (field.name == name)
              found = field;
          found;
        case TInst(_, [param]): anonymousField(owner, param, name);
        case TFun(args, result):
          var found = anonymousField(owner, result, name);
          for (arg in args)
            if (found == null)
              found = anonymousField(owner, arg.t, name);
          found;
        case TLazy(get): anonymousField(owner, get(), name);
        default: null;
      }
    }
    function anonymousCycle(label: String, owner: haxe.macro.Type,
        type: haxe.macro.Type, name: String): Void {
      final field = anonymousField(label, type, name);
      if (field == null)
        fail('metadata fingerprint', '$label: anonymous field $name', 'none');
      else
        cycle(label, owner, field.meta);
    }
    final chain = Context.getType('inc.Chain.ChainB');
    switch chain {
      case TType(ref, _):
        anonymousCycle('typedef anonymous field', chain, ref.get().type, 'x');
      default:
        fail('metadata fingerprint', 'typedef inc.Chain.ChainB',
          Std.string(chain));
    }
    final anonSig = Context.getType('inc.AnonSig');
    switch anonSig {
      case TInst(ref, _):
        for (field in ref.get().statics.get())
          switch field.name {
            case 'point':
              anonymousCycle('anonymous field in a variable type', anonSig,
                field.type, 'x');
            case 'take':
              anonymousCycle('anonymous field in an argument', anonSig,
                field.type, 'y');
            case 'make':
              anonymousCycle('anonymous field in a result', anonSig,
                field.type, 'z');
            case 'rows':
              anonymousCycle('anonymous field in a type argument', anonSig,
                field.type, 'w');
            default:
          }
      default:
        fail('metadata fingerprint', 'class inc.AnonSig', Std.string(anonSig));
    }
    // genes-f8vc.9.26, L5: the fields of anonymous structures in
    // type-parameter constraints, at each place that declares type
    // parameters. `rank` and `order` name their own parameter in the
    // constraint; each `print` must end.
    function constraintField(params: Array<haxe.macro.Type.TypeParameter>,
        name: String): Null<haxe.macro.Type.ClassField> {
      var found: Null<haxe.macro.Type.ClassField> = null;
      for (param in params)
        switch param.t {
          case TInst(ref, _):
            switch ref.get().kind {
              case KTypeParameter(constraints):
                for (constraint in constraints)
                  if (found == null)
                    found = anonymousField('constraint', constraint, name);
              default:
            }
          default:
        }
      return found;
    }
    function constraintCycle(label: String, print: () -> String,
        params: Array<haxe.macro.Type.TypeParameter>, name: String): Void {
      final field = constraintField(params, name);
      if (field == null)
        fail('metadata fingerprint', '$label: constraint field $name', 'none');
      else
        cycleText(label, print, field.meta);
    }
    // Round 2 of the review of #246, M1: metadata on a type parameter
    // itself (`@:ts.type` on `T`), which the TypeScript printer reads where
    // `T` is used.
    function parameterCycle(label: String, print: () -> String,
        params: Array<haxe.macro.Type.TypeParameter>): Void {
      if (params.length == 0)
        fail('metadata fingerprint', '$label: a type parameter', 'none');
      else
        switch params[0].t {
          case TInst(ref, _):
            cycleText(label, print, ref.get().meta);
          default:
            fail('metadata fingerprint', '$label: a type parameter',
              Std.string(params[0].t));
        }
    }
    function ofType(type: haxe.macro.Type): () -> String
      return () -> genes.incremental.ModuleFingerprint.of([type], [], []);
    final constrained = Context.getType('inc.Constrained');
    switch constrained {
      case TInst(ref, _):
        for (field in ref.get().statics.get())
          switch field.name {
            case 'pick':
              constraintCycle('constraint of a method type parameter',
                ofType(constrained), field.params, 'v');
            case 'rank':
              constraintCycle('constraint that names its own parameter',
                ofType(constrained), field.params, 'r');
            case 'tag':
              parameterCycle('metadata of a method type parameter',
                ofType(constrained), field.params);
            default:
          }
      default:
        fail('metadata fingerprint', 'class inc.Constrained',
          Std.string(constrained));
    }
    final box = Context.getType('inc.Constrained.ConstrainedBox');
    switch box {
      case TInst(ref, _):
        constraintCycle('constraint of a class type parameter', ofType(box),
          ref.get().params, 'c');
        parameterCycle('metadata of a class type parameter', ofType(box),
          ref.get().params);
      default:
        fail('metadata fingerprint', 'class inc.Constrained.ConstrainedBox',
          Std.string(box));
    }
    final def = Context.getType('inc.Constrained.ConstrainedDef');
    switch def {
      case TType(ref, _):
        constraintCycle('constraint of a typedef type parameter', ofType(def),
          ref.get().params, 'd');
        parameterCycle('metadata of a typedef type parameter', ofType(def),
          ref.get().params);
      default:
        fail('metadata fingerprint', 'typedef inc.Constrained.ConstrainedDef',
          Std.string(def));
    }
    final abs = Context.getType('inc.Constrained.ConstrainedAbs');
    switch abs {
      case TAbstract(ref, _):
        constraintCycle('constraint of an abstract type parameter',
          ofType(abs), ref.get().params, 'a');
        parameterCycle('metadata of an abstract type parameter', ofType(abs),
          ref.get().params);
      default:
        fail('metadata fingerprint',
          'abstract inc.Constrained.ConstrainedAbs', Std.string(abs));
    }
    final held = Context.getType('inc.Constrained.ConstrainedEnum');
    switch held {
      case TEnum(ref, _):
        final hold = ref.get().constructs.get('Hold');
        if (hold == null)
          fail('metadata fingerprint', 'constructor ConstrainedEnum.Hold',
            'none');
        else {
          constraintCycle('constraint of an enum constructor type parameter',
            ofType(held), hold.params, 'e');
          parameterCycle('metadata of an enum constructor type parameter',
            ofType(held), hold.params);
        }
      default:
        fail('metadata fingerprint', 'enum inc.Constrained.ConstrainedEnum',
          Std.string(held));
    }
    final paramEnum = Context.getType('inc.Constrained.ParamEnum');
    switch paramEnum {
      case TEnum(ref, _):
        parameterCycle('metadata of an enum type parameter',
          ofType(paramEnum), ref.get().params);
      default:
        fail('metadata fingerprint', 'enum inc.Constrained.ParamEnum',
          Std.string(paramEnum));
    }
    // M3 of the cross-model review of #246: the type parameters that a
    // structure field declares (`{function pick<T>(item: T): T;}`), with
    // their metadata and the structures in their constraints.
    function structureField(label: String, type: haxe.macro.Type,
        name: String): Null<haxe.macro.Type.ClassField> {
      final field = anonymousField(label, type, name);
      if (field == null)
        fail('metadata fingerprint', '$label: structure field $name', 'none');
      return field;
    }
    final fableApi = Context.getType('inc.FableProbe.FableApi');
    switch fableApi {
      case TType(ref, _):
        final pick = structureField('typedef structure field', ref.get().type,
          'pick');
        if (pick != null)
          parameterCycle('metadata of a type parameter of a typedef structure field',
            ofType(fableApi), pick.params);
      default:
        fail('metadata fingerprint', 'typedef inc.FableProbe.FableApi',
          Std.string(fableApi));
    }
    final fable = Context.getType('inc.FableProbe');
    switch fable {
      case TInst(ref, _):
        for (field in ref.get().statics.get())
          switch field.name {
            case 'call':
              final sel = structureField('structure in an argument',
                field.type, 'sel');
              if (sel != null)
                parameterCycle('metadata of a type parameter of a structure field in an argument',
                ofType(fable), sel.params);
            case 'wide':
              final sel = structureField('structure in an argument',
                field.type, 'sel');
              if (sel != null)
                constraintCycle('constraint of a type parameter of a structure field',
                ofType(fable), sel.params, 'w');
            default:
          }
      default:
        fail('metadata fingerprint', 'class inc.FableProbe', Std.string(fable));
    }
    // genes-f8vc.9.26, L6: a member that the walk adds late (not in the
    // generator's list) carries its declaration text in the final member
    // list; a listed member does not, because its fingerprint holds it.
    function lateCycle(label: String, member: genes.Module.Member,
        meta: haxe.macro.Type.MetaAccess): Void {
      cycleText('late $label',
        () -> genes.incremental.ModuleFingerprint.members([member], _ -> false),
        meta);
      final listed = () ->
        genes.incremental.ModuleFingerprint.members([member], _ -> true);
      final before = listed();
      meta.add(':probe.mark', arg('a'), pos);
      expectText('listed $label: no declaration text', before, listed());
      meta.remove(':probe.mark');
    }
    final late = Context.getType('inc.LateEnum');
    switch late {
      case TEnum(ref, _):
        final enm = ref.get();
        lateCycle('enum', genes.Module.Member.MEnum(enm, []), enm.meta);
        final item = enm.constructs.get('Item');
        if (item == null)
          fail('metadata fingerprint', 'constructor inc.LateEnum.Item', 'none');
        else {
          lateCycle('enum constructor', genes.Module.Member.MEnum(enm, []),
            item.meta);
          final field = anonymousField('late enum', item.type, 'q');
          if (field == null)
            fail('metadata fingerprint', 'late enum: anonymous field q',
              'none');
          else
            lateCycle('enum anonymous field',
              genes.Module.Member.MEnum(enm, []), field.meta);
        }
      default:
        fail('metadata fingerprint', 'enum inc.LateEnum', Std.string(late));
    }
    final lateBox = Context.getType('inc.LateEnum.LateBox');
    switch lateBox {
      case TInst(ref, _):
        final cls = ref.get();
        lateCycle('class', genes.Module.Member.MClass(cls, [], []), cls.meta);
        final field = constraintField(cls.params, 'lb');
        if (field == null)
          fail('metadata fingerprint', 'late class: constraint field lb',
            'none');
        else
          lateCycle('class constraint field',
            genes.Module.Member.MClass(cls, [], []), field.meta);
        if (cls.params.length == 0)
          fail('metadata fingerprint', 'late class: a type parameter', 'none');
        else
          switch cls.params[0].t {
            case TInst(param, _):
              lateCycle('class type parameter metadata',
                genes.Module.Member.MClass(cls, [], []), param.get().meta);
            default:
              fail('metadata fingerprint', 'late class: a type parameter',
                Std.string(cls.params[0].t));
          }
      default:
        fail('metadata fingerprint', 'class inc.LateEnum.LateBox',
          Std.string(lateBox));
    }
  }

  /** Returns every `.hx` file below `folder`, sorted. */
  static function haxeFiles(folder: String): Array<String> {
    final result = [];
    final entries = sys.FileSystem.readDirectory(folder);
    entries.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    for (entry in entries) {
      final path = haxe.io.Path.join([folder, entry]);
      if (sys.FileSystem.isDirectory(path))
        for (file in haxeFiles(path))
          result.push(file);
      else if (StringTools.endsWith(entry, '.hx'))
        result.push(path);
    }
    return result;
  }

  /** The rules that slice S1 added before any replay (items of the review of #243). */
  static function checkReplayRules(): Void {
    final epochs = [
      'app.Clean' => 'class:app.Clean@n:1',
      'app.Index' => 'class:app.Index@n:1',
      'app.Types' => 'typedef:app.Types@n:1'
    ];
    final fingerprints = ['app.Clean' => 'f-clean', 'app.Index' => 'f-index', 'app.Types' => 'f-types'];
    // Item 1: a failed same-object test anywhere falls back.
    store(epochs, fingerprints, [], []);
    expectFallback('a failed same-object test',
      GenerationCache.decide(facts(epochs, fingerprints, {
        failures: ['class:app.Other']
      })));
    // Item 1: a declaration without a proof, or with another proof, is dirty.
    expectDecision('a declaration without a same-object proof',
      GenerationCache.decide(facts(epochs, fingerprints, {
        proofs: ['app.Clean' => null]
      })), 'app.Clean',
      'a declaration has no same-object proof');
    expectDecision('a bucket written after the stored output',
      GenerationCache.decide(facts(epochs, fingerprints,
        {
          proofs: ['app.Clean' => 'class:app.Clean@7']
        })),
      'app.Clean',
      'a declaration object differs from the one that printed the stored output');
    expectDecision('equal proofs',
      GenerationCache.decide(facts(epochs, fingerprints)), 'app.Clean', null);
    // Item 3: no stamp, but present in the generator list with a changed
    // fingerprint: nothing shows that Haxe kept it, so the request falls back.
    final unstamped = epochs.copy();
    unstamped.set('app.Clean', '');
    final changed = fingerprints.copy();
    changed.set('app.Clean', 'f-clean-2');
    expectFallback('no stamp, present, changed fingerprint',
      GenerationCache.decide(facts(unstamped, changed)));
    expectDecision('no stamp, absent, changed fingerprint',
      GenerationCache.decide(facts(unstamped, changed, {
        absent: ['app.Clean']
      })), 'app.Clean', 'left the program');
    // Item 6: a module without an output file is in rule 6 too.
    store(epochs, fingerprints, [], [], ['app.Types']);
    final typesChanged = fingerprints.copy();
    typesChanged.set('app.Types', 'f-types-2');
    expectFallback('a module without an output file changed its fingerprint',
      GenerationCache.decide(facts(epochs, typesChanged)));
    // Item 4: a stored map source inside the folder where the paths part.
    store(epochs, fingerprints, [], [], null,
      {mapSources: ['/p/cand/rev-3/gen/app/Clean.hx']});
    expectDecision('a map source inside the stored parting folder',
      GenerationCache.decide(facts(epochs, fingerprints,
        {
          outputFolder: '/p/cand/rev-4/output'
        })),
      'app.Clean',
      'a source of its source maps is inside the folder where the output paths ' +
      'part: /p/cand/rev-3/gen/app/Clean.hx');
    expectDecision('the same output folder',
      GenerationCache.decide(facts(epochs, fingerprints)), 'app.Clean', null);
    store(epochs, fingerprints, [], [], null,
      {mapSources: ['/p/src/app/Clean.hx']});
    expectDecision('a map source outside the parting folders',
      GenerationCache.decide(facts(epochs, fingerprints, {
        outputFolder: '/p/cand/rev-4/output'
      })), 'app.Clean', null);
    expectText('parting folders', '/p/cand/rev-3,/p/cand/rev-4',
      GenerationCache.partingFolders('/p/cand/rev-3/output',
        '/p/cand/rev-4/output')
        .join(','));
    // Rule 10: a module that asked for a feature that emission adds.
    store(epochs, fingerprints, [], [], null, {
      answers: [GenerationCache.answerLine('feature', 'use.' + '$' + 'bind',
        '0')]
    });
    expectDecision('asked for a feature that emission adds',
      GenerationCache.decide(facts(epochs, fingerprints)), 'app.Clean',
      'asked for the feature use.' + '$' + 'bind, which emission can add');
    // Item 7: compare and reuse do not use a cache of afterTyping measure.
    store(epochs, fingerprints, [], [], null, {underReuse: false});
    switch GenerationCache.decide(facts(epochs, fingerprints)) {
      case NoCache(_):
        cases++;
      case other:
        fail('a cache written with afterTyping measure', 'NoCache',
          Std.string(other));
    }
    GenerationCache.drop();
  }

  static function expectFallback(name: String, decision: CacheDecision): Void {
    switch decision {
      case Fallback(_):
        cases++;
      default:
        fail(name, 'Fallback', Std.string(decision));
    }
  }

  static function expectDecision(name: String, decision: CacheDecision,
      module: String, wantReason: Null<String>): Void {
    switch decision {
      case Rules(clean, dirty):
        expectState(name, wantReason == null, clean, dirty, module, wantReason);
      default:
        fail(name, 'Rules', Std.string(decision));
    }
  }

  static function store(epochs: Map<String, String>,
      fingerprints: Map<String, String>, globalReads: Array<String>,
      reads: Map<String, Array<String>>, ?inventoryOnly: Array<String>,
      ?options: StoreOptions): Void {
    final modules = new Map<String, CachedModule>();
    final others = new Map<String, CachedInventoryModule>();
    final skip = inventoryOnly == null ? [] : inventoryOnly;
    for (module => text in epochs) {
      if (skip.indexOf(module) >= 0) {
        others.set(module,
          {epochs: text, fingerprint: fingerprints.get(module)});
        continue;
      }
      final read = reads.get(module);
      modules.set(module, {
        epochs: text,
        fingerprint: fingerprints.get(module),
        witnesses: read == null ? [] : [
          for (name in read)
            {module: name, epochs: epochs.get(name)}
        ],
        usedHaxePrinter: false,
        files: [],
        warnings: [],
        proofs: proofOf(module),
        members: '',
        rootFlags: '',
        answers: options != null
        && options.answers != null ? options.answers : [],
        additions: [],
        publicEntries: [],
        mapSources: options != null
        && options.mapSources != null ? options.mapSources : [],
        visits: [],
        runtimeRequests: null
      });
    }
    GenerationCache.commit(KEY, DIGEST, [
      for (name in globalReads)
        {module: name, epochs: epochs.get(name)}
    ],
      modules,
      others, options != null && options.outputFolder != null ? options.outputFolder : OUTPUT, options == null
      || options.underReuse != false);
  }

  /** The made-up same-object proof text of one module. */
  static function proofOf(module: String): String {
    return 'class:$module@1';
  }

  static function facts(epochs: Map<String, String>,
      fingerprints: Map<String, String>,
      ?options: FactOptions): CacheRequestFacts {
    final absent = options != null
      && options.absent != null ? options.absent : [];
    final proofs = options != null
      && options.proofs != null ? options.proofs : new Map();
    return {
      present: module -> epochs.exists(module) && absent.indexOf(module) < 0,
      proofs: module ->
        proofs.exists(module) ? proofs.get(module) : proofOf(module),
      sameObjectFailures: options != null
      && options.failures != null ? options.failures : [],
      outputFolder: options != null
      && options.outputFolder != null ? options.outputFolder : OUTPUT,
      needsReuseCache: true,
      sessionKey: KEY,
      reservedNameDigest: DIGEST,
      rootModule: 'app.Index',
      fingerprint: module -> {
        final known = fingerprints.get(module);
        known == null ? '' : known;
      },
      epochs: module -> {
        final known = epochs.get(module);
        known == null ? '' : known;
      }
    };
  }

  static function expectState(name: String, wantClean: Bool,
      clean: Map<String, Bool>, dirty: Map<String, String>, module: String,
      wantReason: Null<String>): Void {
    cases++;
    final isClean = clean.exists(module);
    final reason = dirty.get(module);
    if (isClean != wantClean || reason != wantReason)
      fail(name, wantClean ? 'clean' : 'dirty ($wantReason)',
        isClean ? 'clean' : 'dirty ($reason)');
  }

  static function expectRefusal(name: String, wanted: Null<String>,
      generation: GenerationReuse, afterTyping: AfterTypingReuse): Void {
    cases++;
    final refusal = IncrementalRequest.generationRefusal({
      path: '/probe/request.json',
      programDigest: 'probe',
      kind: Full,
      afterTyping: afterTyping,
      generation: generation
    });
    final code = refusal == null ? null : IncrementalRequest.refusalCode(refusal);
    if (code != wanted)
      fail(name, Std.string(wanted), Std.string(code));
  }

  static function expectText(name: String, wanted: String,
      actual: String): Void {
    cases++;
    if (actual != wanted)
      fail(name, wanted, actual);
  }

  static function expectDifferent(name: String, other: String,
      actual: String): Void {
    cases++;
    if (actual == other)
      fail(name, 'a text other than ${other}', actual);
  }

  static function fail(name: String, wanted: String, actual: String): Void {
    Context.fatalError('clean-rule-probe: "$name": expected $wanted, got $actual',
      Context.currentPos());
  }
}
