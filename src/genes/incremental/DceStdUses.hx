package genes.incremental;

#if macro
import haxe.io.Path;
import haxe.macro.Context;
import haxe.macro.Expr.Binop;
import haxe.macro.Expr.Unop;
import haxe.macro.Type;
import haxe.macro.TypeTools;
import haxe.macro.TypedExprTools;
import sys.FileSystem;
import genes.util.PathUtil;
import genes.util.TypeUtil;

using haxe.macro.TypeTools;

/**
 * The facts of one module that the `-dce std` admission rule of a module
 * request compares (`ModuleRequest`, genes-f8vc.14.7): what Haxe 4.3.7's
 * dead-code elimination does from the module's code, and which modules the
 * module makes Haxe load. Plain text only.
 *
 * Why: under `-dce std`, Haxe keeps every class of the project whole
 * (`keep_whole_class` in `dce.ml`), so a new field, call or import of a
 * project module changes only that module's own output file, unless it
 * reaches outside it. It reaches outside it in a few ways, and this class
 * names each of them as a line of text that the rule can compare with the
 * same text of the last full request:
 *
 * - `keep <module> <kept line>`: the code keeps a field or a class that
 *   dead-code elimination may remove. Under `-dce std` that is a class on
 *   Haxe's standard-library path or with `@:dce` (`eligibleClass`). Example:
 *   a first call of `StringTools.trim` keeps that field, and a full build
 *   then prints it into `StringTools.ts`. The kept line has the form of
 *   `ModuleRequest.keptLines`, for example `keep StringTools class
 *   StringTools.StringTools s:trim`.
 * - `feature <name>`: a feature that dead-code elimination checks or adds
 *   for the code (`check_feature`, `check_and_add_feature`). Haxe keeps a
 *   field with `@:ifFeature(<name>)` when the feature is checked, and the
 *   generator's `hasFeature` answers from the added ones. Example: the first
 *   typed `cast` checks `typed_cast`, which keeps `js.Boot.__cast`.
 * - `multitype <abstract> <arguments>`: a `@:multiType` abstract such as
 *   `Map<String, Int>`. Haxe marks a specialization that a macro cannot
 *   compute, so the line names the abstract and its arguments.
 * - `value <abstract>.*`: the code uses an abstract as a value (`return
 *   Int;`, a typed cast to it). Haxe then sets `@:valueUsed`, the only mark
 *   that answers `hasFeature("Int.*")`, and `Std.__init__` prints `var Int
 *   = { };`. A type use gives only the `feature` line.
 * - `dependent <class> <field>`: a field of an extern class or interface is
 *   marked. Haxe then also marks the overriding fields of subclasses
 *   (`mark_dependent_fields`), which can be classes that dead-code
 *   elimination may change (`externBasesOf`).
 * - `unknown <reason>`: the walk reached its nesting limit and may have
 *   missed marks; the rule refuses (`dce-uses-unknown`).
 *
 * `dependenciesOf` gives the modules that the module makes Haxe load: the
 * modules of every declaration that its typed declarations and bodies name,
 * and the modules of its import and using lines (`importsOf`). Example: a
 * module that drops `import app.Legacy;` no longer loads `app.Legacy`; when
 * nothing else loads it, a full build drops `app/Legacy.ts`.
 *
 * How: `usesOf` is a port of the marking functions of Haxe 4.3.7's
 * `src/optimization/dce.ml` (`expr`, `expr_field`, `field`, `mark_field`,
 * `mark_class`, `mark_enum`, `mark_abstract`, `mark_t`, `to_string`),
 * applied to every field of the module, as `collect_entry_points` and
 * `mark` do for a class that is kept whole. It is an over-approximation:
 * where Haxe chooses a feature from a type test (for example `add_dynamic`
 * or `unsafe_string_concat` for `+`), the port writes every feature that
 * the expression's form can give. A line too many can only refuse a
 * preview; a missing line could publish a stale one, so the port never
 * leaves one out on purpose. Marks on fields of the module itself are left
 * out: the module is kept whole, so its own fields are marked in every
 * build. `ModuleRequest` checks the features named after its own fields
 * from its declarations instead.
 *
 * Limits: the port follows Haxe 4.3.7 (`IncrementalRequest` limits the
 * incremental path to that version). The dependency list is a lower bound
 * of what Haxe loads: it does not see a module that a macro loads by name or
 * an import inside `#if`, and the typed bodies no longer name the class of
 * an inline function or an inline constant that they call, or of a macro.
 * `ModuleRequest` adds Haxe's own list for those (`HaxeDependencies`,
 * genes-f8vc.14.26). The rule only uses the list to prove that a module
 * stays loaded, so a missing entry can refuse a preview but never admit a
 * wrong one.
 */
class DceStdUses {
  /**
   * The class-path folders that Haxe calls the standard library, lower
   * case, each ending with `/`, or `null` before `stdFolders` read them in
   * this request.
   */
  static var stdFolderList: Null<Array<String>> = null;

  /** Forgets the facts of the last request. `ModuleRequest.begin` calls it. */
  public static function reset(): Void {
    stdFolderList = null;
    stdFiles = new Map();
  }

  /**
   * Returns true when the request runs with `-dce std`, the profile of this
   * rule; Haxe gives the `dce` define that value when a build names no
   * `-dce`, so a default build counts. Example: `-dce full` gives false, and
   * a module request keeps the stricter rule that refuses every structural
   * edit.
   */
  public static function stdProfile(): Bool {
    return Context.definedValue('dce') == 'std';
  }

  /**
   * Returns the standard-library folders as Haxe 4.3.7 finds them
   * (`compiler.ml`: the class paths that end with `std/`), absolute, in
   * lower case, each with a final `/`.
   *
   * Why lower case: Haxe compares unique file keys, which ignore case on a
   * file system that ignores case. A folder that matches one more file only
   * makes one more class eligible, which can refuse a preview but not admit
   * a wrong one.
   */
  static function stdFolders(): Array<String> {
    final known = stdFolderList;
    if (known != null)
      return known;
    final folders = [];
    for (entry in Context.getClassPath()) {
      final normalized = StringTools.replace(entry, '\\', '/');
      if (!StringTools.endsWith(normalized, 'std/'))
        continue;
      var absolute = PathUtil.normalize(FileSystem.absolutePath(entry))
        .toLowerCase();
      if (!StringTools.endsWith(absolute, '/'))
        absolute += '/';
      folders.push(absolute);
    }
    stdFolderList = folders;
    return folders;
  }

  /** The answers of `isStdFile` in this request, by file. */
  static var stdFiles: Map<String, Bool> = new Map();

  /** Returns true when `file` is in a standard-library folder (`is_std_file`). */
  public static function isStdFile(file: String): Bool {
    final known = stdFiles.get(file);
    if (known != null)
      return known;
    final found = isStdPath(PathUtil.normalize(FileSystem.absolutePath(file)));
    stdFiles.set(file, found);
    return found;
  }

  /**
   * Returns true when `absolute`, an absolute and normalized file path, is
   * in a standard-library folder. `HaxeDependencies` calls it with paths
   * that it keeps between requests.
   */
  public static function isStdPath(absolute: String): Bool {
    final lower = absolute.toLowerCase();
    for (folder in stdFolders())
      if (StringTools.startsWith(lower, folder))
        return true;
    return false;
  }

  /**
   * Returns true when dead-code elimination under `-dce std` may remove
   * fields of `cls`: the negation of `keep_whole_class` in Haxe 4.3.7's
   * `dce.ml` for a class that Genes can print. An extern class is never
   * eligible here: Haxe keeps it whole, and its fields are kept as extern
   * fields (also `Math` and `Array`, whose marks change no output).
   *
   * Example: `StringTools` (standard library) and `haxe.io.Bytes` of Genes
   * (`@:dce`) are eligible; `app.ui.Button` is not.
   */
  public static function eligibleClass(cls: ClassType): Bool {
    if (cls.isExtern || cls.meta.has(':keep') || cls.meta.has(':expose'))
      return false;
    if (superForcesKeep(cls))
      return false;
    return cls.meta.has(':dce') || isStdFile(Context.getPosInfos(cls.pos).file);
  }

  /** Returns true when dead-code elimination may remove `enm` (`keep_whole_enum`). */
  public static function eligibleEnum(enm: EnumType): Bool {
    if (enm.isExtern || enm.meta.has(':keep') || enm.meta.has(':expose'))
      return false;
    return enm.meta.has(':dce') || isStdFile(Context.getPosInfos(enm.pos).file);
  }

  /** `super_forces_keep`: the class or a parent class has `@:keepSub`. */
  static function superForcesKeep(cls: ClassType): Bool {
    var current: Null<ClassType> = cls;
    var depth = 0;
    // Past 64 parents the class counts as eligible, which can only refuse.
    while (current != null && depth++ < 64) {
      if (current.meta.has(':keepSub'))
        return true;
      final parent = current.superClass;
      current = parent == null ? null : parent.t.get();
    }
    return false;
  }

  /**
   * Returns true when no declaration of `types` (one module) is eligible:
   * Haxe keeps the whole module under `-dce std`. Typedefs and abstracts
   * have nothing to remove.
   */
  public static function keptWhole(types: Array<Type>): Bool {
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          if (!cls.isExtern && eligibleClass(cls))
            return false;
        case TEnum(reference, _):
          if (eligibleEnum(reference.get()))
            return false;
        default:
      }
    return true;
  }

  /**
   * Returns the dead-code-elimination lines of one module (see the class
   * comment), sorted and unique. `module` is the module of `types`, which
   * are all of its declarations before dead-code elimination.
   *
   * Example: `static function title() return StringTools.trim(' a ');` in
   * `app.Card` gives, among others, `feature StringTools.trim` and
   * `keep StringTools class StringTools.StringTools s:trim`.
   */
  public static function usesOf(module: String,
      types: Array<Type>): Array<String> {
    final walk = new DceStdWalk(module);
    for (type in types)
      switch type {
        case TInst(reference, _):
          walk.entry(reference.get());
        case TEnum(reference, _):
          walk.markEnum(reference.get());
        default:
      }
    return walk.result();
  }

  /**
   * Returns the extern parent classes and interfaces (full names, sorted)
   * of the classes of `types` that dead-code elimination may change
   * (`eligibleClass`). A first mark of a field of such an extern declaration
   * also marks the overriding field of the eligible class
   * (`mark_dependent_fields`), so the rule checks the `dependent` lines that
   * name it.
   *
   * Example: `haxe.Exception` (standard library) extends the extern
   * `js.lib.Error`, so `js.lib.Error.Error` is returned for its module.
   */
  public static function externBasesOf(types: Array<Type>): Array<String> {
    final found = new Map<String, Bool>();
    function walk(cls: ClassType, depth: Int): Void {
      // `*`: the chain is longer than the walk follows, so every extern
      // class counts (`ModuleRequest` then checks every `dependent` line).
      if (depth > 64) {
        found.set('*', true);
        return;
      }
      final items = cls.interfaces.copy();
      final parent = cls.superClass;
      if (parent != null)
        items.push(parent);
      for (item in items) {
        final base = item.t.get();
        if (base.isExtern)
          found.set(TypeUtil.baseTypeFullName(base), true);
        walk(base, depth + 1);
      }
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          if (eligibleClass(cls))
            walk(cls, 0);
        default:
      }
    final result = [for (name in found.keys()) name];
    result.sort(compareStrings);
    return result;
  }

  /**
   * Returns the static calls of the bodies of `types` (one module) that a
   * `using` line can make, one line each, sorted and unique: `<class>
   * <name>` for a static function `name` called with a first argument whose
   * type is the class `<class>` (full name), and one line for each parent
   * class of it.
   *
   * Why: Haxe looks for a field of the class before it tries a static
   * extension (`type_field` in `fields.ml`). So a new instance field of
   * that name, also a private one, changes the call in this module, or
   * makes it fail ("Cannot access private field"). Example: `using
   * app.Tools; g.label();` calls `Tools.label(g)` and gives `app.Gadget.Gadget
   * label`; a new private `label()` in `app.Gadget` then takes the call. A
   * plain static call with an argument gives a line too, which can only
   * refuse a preview.
   *
   * Limits: an inline extension leaves no static call in the typed body,
   * and a first argument whose type is a type parameter or an abstract
   * gives no line. Such a call is changed by a new private field only where
   * some module of the program may see private fields, and `ModuleRequest`
   * then keeps every private field in the visible shape (`privateReachOf`,
   * `@:allow`, `@:access`). Elsewhere the new field makes the program fail
   * to compile ("Cannot access private field"), which a module request does
   * not see.
   */
  public static function extensionCallsOf(types: Array<Type>): Array<String> {
    final found = new Map<String, Bool>();
    function visit(expression: TypedExpr): Void {
      switch expression.expr {
        case TCall({expr: TField(_, FStatic(_, field))}, args)
          if (args.length > 0):
          switch Context.follow(args[0].t) {
            case TInst(owner, _):
              var current: Null<ClassType> = owner.get();
              var depth = 0;
              while (current != null && depth++ < 64) {
                if (!current.kind.match(KTypeParameter(_)))
                  found.set('${TypeUtil.baseTypeFullName(current)} ${field.get().name}',
                    true);
                final parent = current.superClass;
                current = parent == null ? null : parent.t.get();
              }
            default:
          }
        default:
      }
      genes.incremental.RequestMeasure.factNode();
      TypedExprTools.iter(expression, visit);
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final fields = cls.statics.get().concat(cls.fields.get());
          final constructor = cls.constructor;
          if (constructor != null)
            fields.push(constructor.get());
          for (field in fields) {
            genes.incremental.RequestMeasure.bodyRead(field);
            final body = field.expr();
            if (body != null)
              visit(body);
          }
          final init = cls.init;
          if (init != null)
            visit(init);
        default:
      }
    final result = [for (line in found.keys()) line];
    result.sort(compareStrings);
    return result;
  }

  /** `is_physical_field` of Haxe 4.3.7 (`tFunctions.ml`). */
  public static function isPhysicalField(field: ClassField): Bool {
    return switch field.kind {
      case FMethod(_): true;
      case FVar(read, write):
        switch read {
          case AccNormal | AccInline | AccNo: true;
          default:
            switch write {
              case AccNormal | AccNo: true;
              default: field.meta.has(':isVar');
            }
        }
    }
  }

  /**
   * Returns the features that fields of `types` listen to
   * (`@:ifFeature(<name>, ...)`), each with the kept line of its field
   * (`<module> class <type> s:<field>`, as in `usesOf`). Haxe keeps such a
   * field of an eligible class when one of its features is checked.
   *
   * Example: `js.Boot` gives `typed_cast` with `js.Boot class
   * js.Boot.Boot s:__cast`.
   */
  public static function listenersOf(types: Array<Type>): Array<{feature: String, line: String}> {
    final found = [];
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final name = TypeUtil.baseTypeFullName(cls);
          function add(field: ClassField, label: String): Void {
            for (entry in field.meta.extract(':ifFeature'))
              for (param in (entry.params == null ? [] : entry.params))
                switch param.expr {
                  case EConst(CString(feature, _)):
                    found.push({
                      feature: feature,
                      line: '${cls.module} class $name $label'
                    });
                  default:
                }
          }
          for (field in cls.statics.get())
            add(field, 's:${field.name}');
          for (field in cls.fields.get())
            add(field, 'i:${field.name}');
          final constructor = cls.constructor;
          if (constructor != null)
            add(constructor.get(), 'new');
        default:
      }
    return found;
  }

  /**
   * Returns the text of a module's source file, or `null` when there is no
   * file or it cannot be read. `dependenciesOf` and `privateReachOf` read
   * the same text, so a module request reads each file once.
   */
  public static function sourceText(file: Null<String>): Null<String> {
    if (file == null || !FileSystem.exists(file))
      return null;
    return try sys.io.File.getContent(file) catch (_:haxe.Exception) null;
  }

  /**
   * Returns why the code of a module (its declarations `types` and its
   * source `text`) may see a private field of another module without naming
   * it in metadata, or `null`. `ModuleRequest` then keeps every private
   * field of the requested module in its visible shape
   * (`ModuleRequest.privateAccessors`), because a new private field can
   * change how such code types. The reasons, each from Haxe 4.3.7:
   *
   * - `has @:privateAccess code`: the text holds `privateAccess`. Inside
   *   `@:privateAccess`, Haxe skips the access check (`can_access` in
   *   `typecore.ml`), and it looks for a field of the class before it tries
   *   a static extension (`type_field` in `fields.ml`). Example: `using
   *   app.Tools; return @:privateAccess gizmo.label();` calls the inline
   *   extension `Tools.label(gizmo)`; after a private `label()` is added to
   *   `app.Gizmo`, a full build calls `gizmo.label()`. Haxe keeps no trace of
   *   the metadata in the typed body, so only the text shows it. A match in
   *   a comment or a string only refuses more previews.
   * - `has untyped code`: a field has `:has_untyped`, which Haxe adds to each
   *   field whose body has `untyped` code (`typer.ml`), also code that a
   *   macro returned. `untyped` skips the access check too
   *   (`check_field_access`). The text is not read for it, so a comment does
   *   not count.
   * - `has an __init__ function with @:access or untyped code`: a class has
   *   `__init__`, and the text holds `:access` or the word `untyped`. Haxe
   *   moves the body of `__init__` to the class and drops the field with its
   *   metadata, so neither `@:access` nor `:has_untyped` can be read.
   * - `imports the static fields of a type`: an import line ends with
   *   `<Type>.*`. Haxe then imports the private static fields too
   *   (`importHandling.ml`), and it types a pattern with the access check
   *   off (`matcher.ml`). Example: with `import app.Dial.*;`, the capture
   *   `case label:` becomes a comparison with a new private
   *   `static final label`. Lines inside `#if` count too.
   * - `has no readable source`: `text` is `null`, so nothing above can be
   *   read (for example a module that a macro defines without a file).
   *
   * A structure type with a private field is a reason too, but it counts
   * also for the requested module itself, so `ModuleRequest` reads it on its
   * own (`privateStructureOf`).
   */
  public static function privateReachOf(types: Array<Type>,
      text: Null<String>): Null<String> {
    if (text == null)
      return 'has no readable source';
    if (text.indexOf('privateAccess') >= 0)
      return 'has @:privateAccess code';
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final fields = cls.statics.get().concat(cls.fields.get());
          final constructor = cls.constructor;
          if (constructor != null)
            fields.push(constructor.get());
          for (field in fields)
            if (field.meta.has(':has_untyped'))
              return 'has untyped code';
          if (cls.init != null
            && (text.indexOf(':access') >= 0 || UNTYPED_WORD.match(text)))
            return 'has an __init__ function with @:access or untyped code';
        default:
      }
    if (importsTypeStatics(text))
      return 'imports the static fields of a type (`import <Type>.*`)';
    return null;
  }

  /** The word `untyped`, not a part of a longer name. */
  static final UNTYPED_WORD = ~/(^|[^A-Za-z0-9_])untyped($|[^A-Za-z0-9_])/;

  /**
   * Returns true when an import line of a Haxe source text imports the
   * static fields of a type: `import <path>.<Type>.*`, where `<Type>`
   * starts with a capital letter. Lines inside `#if` count too, because
   * their condition is not read. A whole-package import (`import app.*;`)
   * imports no field.
   *
   * Example: `import app.Dial.*;` and `import app.Dial.Knob.*;` give true;
   * `import app.ui.*;` and `using app.Tools;` give false.
   */
  public static function importsTypeStatics(text: String): Bool {
    for (statement in importStatements(text))
      if (statement.keyword == 'import') {
        final target = StringTools.trim(statement.path.split(' as ')[0].split(' in ')[0]);
        final parts = [for (part in target.split('.')) StringTools.trim(part)];
        if (parts.length >= 2 && parts[parts.length - 1] == '*') {
          final owner = parts[parts.length - 2];
          final first = owner.length > 0 ? StringTools.fastCodeAt(owner, 0) : 0;
          if (first >= 'A'.code && first <= 'Z'.code)
            return true;
        }
      }
    return false;
  }

  /**
   * Returns true when a declaration, a field type or a typed body of
   * `types` holds a structure type with a private field, such as `typedef
   * Peek = { private function label(): String; }`. The structures that
   * stand for the static fields of a class, an enum or an abstract (`Std`
   * used as a value) are left out: they list private statics, which no
   * unification reads. A type nested deeper than 256 levels counts (the
   * deepest type of Caffeine's program, 1,277 modules, nests 71 levels).
   *
   * Why: Haxe lets a private class field meet a private structure field
   * (`tUnification.ml`), so a new private `label()` of `app.Lamp` makes it
   * unify with `Peek`. A static extension `describe(item: Peek)` can then
   * take `lamp.describe()` from `describe(item: Lamp)`, without any private
   * access in the caller. This holds also when `Peek` is declared in the
   * module of `app.Lamp` itself, so the requested module counts too.
   *
   * A typedef that a type names is followed once (also one of the standard
   * library), so `typedef Pair = { final peek: Peek; }` counts where `Pair`
   * is used.
   */
  public static function privateStructureOf(types: Array<Type>): Bool {
    var found = false;
    final seenParams = new Map<String, Bool>();
    final seenTypedefs = new Map<String, Bool>();
    function inType(value: Null<Type>, depth: Int): Void {
      if (found || value == null)
        return;
      if (depth > 256) {
        found = true;
        return;
      }
      switch value {
        case TAnonymous(reference):
          final anon = reference.get();
          switch anon.status {
            case AClassStatics(_) | AEnumStatics(_) | AAbstractStatics(_):
              return;
            default:
          }
          for (field in anon.fields) {
            if (!field.isPublic) {
              found = true;
              return;
            }
            inType(field.type, depth + 1);
          }
        case TInst(owner, params):
          final cls = owner.get();
          switch cls.kind {
            case KTypeParameter(constraints):
              final key = '${cls.module} ${cls.pack.join('.')} ${cls.name} ${Context.getPosInfos(cls.pos).min}';
              if (!seenParams.exists(key)) {
                seenParams.set(key, true);
                for (constraint in constraints)
                  inType(constraint, depth + 1);
              }
            default:
          }
          for (param in params)
            inType(param, depth + 1);
        case TType(owner, params):
          final def = owner.get();
          final key = TypeUtil.baseTypeFullName(def);
          if (!seenTypedefs.exists(key)) {
            seenTypedefs.set(key, true);
            inType(def.type, depth + 1);
          }
          for (param in params)
            inType(param, depth + 1);
        case TEnum(_, params) | TAbstract(_, params):
          for (param in params)
            inType(param, depth + 1);
        case TFun(args, result):
          for (arg in args)
            inType(arg.t, depth + 1);
          inType(result, depth + 1);
        case TMono(reference):
          inType(reference.get(), depth + 1);
        case TDynamic(inner):
          inType(inner, depth + 1);
        case TLazy(force):
          inType(force(), depth + 1);
      }
    }
    function inBody(expression: TypedExpr): Void {
      if (found)
        return;
      inType(expression.t, 0);
      switch expression.expr {
        case TVar(variable, _):
          inType(variable.t, 0);
        case TFunction(fn):
          for (arg in fn.args)
            inType(arg.v.t, 0);
        case TTry(_, catches):
          for (item in catches)
            inType(item.v.t, 0);
        default:
      }
      genes.incremental.RequestMeasure.factNode();
      TypedExprTools.iter(expression, inBody);
    }
    function inField(field: ClassField): Void {
      inType(field.type, 0);
      for (param in field.params)
        inType(param.t, 0);
      genes.incremental.RequestMeasure.bodyRead(field);
      final body = field.expr();
      if (body != null)
        inBody(body);
      for (signature in field.overloads.get())
        inType(signature.type, 0);
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          for (param in cls.params)
            inType(param.t, 0);
          for (field in cls.statics.get())
            inField(field);
          for (field in cls.fields.get())
            inField(field);
          final constructor = cls.constructor;
          if (constructor != null)
            inField(constructor.get());
          final init = cls.init;
          if (init != null)
            inBody(init);
        case TEnum(reference, _):
          final enm = reference.get();
          for (name in enm.names) {
            final construct = enm.constructs.get(name);
            if (construct != null)
              inType(construct.type, 0);
          }
        case TType(reference, _):
          inType(reference.get().type, 0);
        case TAbstract(reference, _):
          final abs = reference.get();
          inType(abs.type, 0);
          for (item in abs.from)
            inType(item.t, 0);
          for (item in abs.to)
            inType(item.t, 0);
        default:
      }
    return found;
  }

  /**
   * Returns the modules other than `module` that its declarations `types`
   * make Haxe load, sorted: the module of every declaration that a field
   * type, a parent class, an interface, an enum constructor, a typedef, an
   * abstract or a typed body names, and the modules of its import and using
   * lines (`text` is its source text, see `sourceText`, or `null`).
   *
   * Example: `class Card { static function render() return Badge.render(); }`
   * with `import app.ui.Badge;` gives `app.ui.Badge` (once).
   *
   * The list is a lower bound (see the class comment): an unknown kind of
   * reference adds nothing, so a dropped reference can only make the rule
   * refuse. Example of a gap: `JsonCodec.unsafeAssumeJson(value)` is inline,
   * so the typed body holds only `value`; `HaxeDependencies` adds such
   * modules from Haxe's own list.
   */
  public static function dependenciesOf(module: String, types: Array<Type>,
      text: Null<String>): Array<String> {
    final found = new Map<String, Bool>();
    function add(name: Null<String>): Void {
      if (name != null && name.length > 0 && name != module)
        found.set(name, true);
    }
    function addType(value: Null<Type>, depth: Int): Void {
      if (value == null || depth > 12)
        return;
      switch value {
        case TInst(owner, params):
          final cls = owner.get();
          switch cls.kind {
            case KTypeParameter(_):
            case KGenericInstance(base, _):
              // The instance of a `@:generic` class lives in a module of its
              // own; Haxe loads the generic class's module to make it.
              add(cls.module);
              add(base.get().module);
            default:
              add(cls.module);
          }
          for (param in params)
            addType(param, depth + 1);
        case TEnum(owner, params):
          add(owner.get().module);
          for (param in params)
            addType(param, depth + 1);
        case TType(owner, params):
          add(owner.get().module);
          for (param in params)
            addType(param, depth + 1);
        case TAbstract(owner, params):
          add(owner.get().module);
          for (param in params)
            addType(param, depth + 1);
        case TFun(args, result):
          for (arg in args)
            addType(arg.t, depth + 1);
          addType(result, depth + 1);
        case TAnonymous(anon):
          for (field in anon.get().fields)
            addType(field.type, depth + 1);
        case TMono(reference):
          addType(reference.get(), depth + 1);
        case TDynamic(inner):
          addType(inner, depth + 1);
        case TLazy(force):
          addType(force(), depth + 1);
      }
    }
    function addModuleType(declaration: ModuleType): Void {
      switch declaration {
        case TClassDecl(reference):
          add(reference.get().module);
        case TEnumDecl(reference):
          add(reference.get().module);
        case TTypeDecl(reference):
          add(reference.get().module);
        case TAbstract(reference):
          add(reference.get().module);
      }
    }
    function addBody(expression: TypedExpr): Void {
      addType(expression.t, 0);
      switch expression.expr {
        case TTypeExpr(declaration):
          addModuleType(declaration);
        case TNew(owner, params, _):
          addType(TInst(owner, params), 0);
        case TField(_, FStatic(owner, _)) | TField(_, FInstance(owner, _, _)):
          add(owner.get().module);
        case TField(_, FClosure(owner, _)) if (owner != null):
          add(owner.c.get().module);
        case TField(_, FEnum(owner, _)):
          add(owner.get().module);
        case TVar(variable, _):
          addType(variable.t, 0);
        case TTry(_, catches):
          for (item in catches)
            addType(item.v.t, 0);
        case TCast(_, declaration) if (declaration != null):
          addModuleType(declaration);
        case TFunction(fn):
          for (arg in fn.args)
            addType(arg.v.t, 0);
          addType(fn.t, 0);
        default:
      }
      genes.incremental.RequestMeasure.factNode();
      TypedExprTools.iter(expression, addBody);
    }
    function addField(field: ClassField): Void {
      addType(field.type, 0);
      genes.incremental.RequestMeasure.bodyRead(field);
      final body = field.expr();
      if (body != null)
        addBody(body);
      for (signature in field.overloads.get()) {
        addType(signature.type, 0);
        genes.incremental.RequestMeasure.bodyRead(signature);
        final other = signature.expr();
        if (other != null)
          addBody(other);
      }
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          final cls = reference.get();
          final parent = cls.superClass;
          if (parent != null)
            addType(TInst(parent.t, parent.params), 0);
          for (item in cls.interfaces)
            addType(TInst(item.t, item.params), 0);
          for (field in cls.statics.get())
            addField(field);
          for (field in cls.fields.get())
            addField(field);
          final constructor = cls.constructor;
          if (constructor != null)
            addField(constructor.get());
          final init = cls.init;
          if (init != null)
            addBody(init);
        case TEnum(reference, _):
          final enm = reference.get();
          for (name in enm.names) {
            final construct = enm.constructs.get(name);
            if (construct != null)
              addType(construct.type, 0);
          }
        case TType(reference, _):
          addType(reference.get().type, 0);
        case TAbstract(reference, _):
          final abs = reference.get();
          addType(abs.type, 0);
          for (item in abs.from)
            addType(item.t, 0);
          for (item in abs.to)
            addType(item.t, 0);
        default:
      }
    if (text != null)
      for (imported in importsOf(text))
        add(imported);
    final result = [for (name in found.keys()) name];
    result.sort(compareStrings);
    return result;
  }

  /**
   * Returns the modules that the import and using lines of one Haxe source
   * text load, in order of appearance, each once: for each line outside
   * `#if` blocks before the first declaration, the path up to its first
   * name that starts with a capital letter (Haxe's module name). A line
   * that imports a whole package (`import app.ui.*;`) loads nothing until a
   * name is used, and is left out, as is a line inside `#if` (its condition
   * is not read).
   *
   * Example: `import app.ui.Button;\nimport app.Leaf.Kind.Small;\nusing
   * StringTools;\n#if debug import app.Debug; #end\nclass X {}` gives
   * `app.ui.Button`, `app.Leaf` and `StringTools`.
   *
   * Why the first declaration ends the search: Haxe 4.3.7 rejects an import
   * after a declaration ("import and using may not appear after a
   * declaration", `typeloadModule.ml`).
   */
  public static function importsOf(text: String): Array<String> {
    final result: Array<String> = [];
    final seen = new Map<String, Bool>();
    for (statement in importStatements(text)) {
      if (statement.conditional)
        continue;
      // `import a.b.C as D` and the older `import a.b.C in D`.
      final target = statement.path.split(' as ')[0].split(' in ')[0];
      final parts = StringTools.trim(target).split('.');
      final named = [];
      for (part in parts) {
        named.push(part);
        final first = part.length > 0 ? StringTools.fastCodeAt(part, 0) : 0;
        if (first >= 'A'.code && first <= 'Z'.code) {
          final name = named.join('.');
          if (!seen.exists(name)) {
            seen.set(name, true);
            result.push(name);
          }
          break;
        }
      }
    }
    return result;
  }

  /**
   * Returns the import and using lines of one Haxe source text before its
   * first declaration, in order: the keyword, the path (comments left out,
   * each run of spaces kept as one space, so that `a.b.C as D` stays
   * readable), and whether the line is inside an `#if` block. `importsOf`
   * and `importsTypeStatics` read them.
   */
  static function importStatements(text: String): Array<{
    keyword: String,
    path: String,
    conditional: Bool
  }> {
    final result = [];
    var index = 0;
    var depth = 0;
    final length = text.length;
    function isNameChar(code: Int): Bool
      return (code >= 'a'.code && code <= 'z'.code)
        || (code >= 'A'.code && code <= 'Z'.code)
        || (code >= '0'.code && code <= '9'.code)
        || code == '_'.code;
    function skipSpaceAndComments(): Void {
      while (index < length) {
        final code = StringTools.fastCodeAt(text, index);
        if (code == ' '.code
          || code == '\t'.code
          || code == '\n'.code
          || code == '\r'.code) {
          index++;
        } else if (code == '/'.code && index + 1 < length
          && StringTools.fastCodeAt(text, index + 1) == '/'.code) {
          while (index < length
            && StringTools.fastCodeAt(text, index) != '\n'.code)
            index++;
        } else if (code == '/'.code && index + 1 < length
          && StringTools.fastCodeAt(text, index + 1) == '*'.code) {
          final end = text.indexOf('*/', index + 2);
          index = end < 0 ? length : end + 2;
        } else {
          return;
        }
      }
    }
    function word(): String {
      final start = index;
      while (index < length && isNameChar(StringTools.fastCodeAt(text, index)))
        index++;
      return text.substring(start, index);
    }
    // The text up to the next `;`.
    function statement(): String {
      final buffer = new StringBuf();
      var space = false;
      while (index < length) {
        final before = index;
        skipSpaceAndComments();
        if (index > before)
          space = true;
        if (index >= length)
          break;
        final code = StringTools.fastCodeAt(text, index);
        index++;
        if (code == ';'.code)
          break;
        if (space)
          buffer.add(' ');
        space = false;
        buffer.addChar(code);
      }
      return StringTools.trim(buffer.toString());
    }
    while (index < length) {
      skipSpaceAndComments();
      if (index >= length)
        break;
      final code = StringTools.fastCodeAt(text, index);
      if (code == '#'.code) {
        index++;
        final directive = word();
        switch directive {
          case 'if':
            depth++;
          case 'end':
            if (depth > 0)
              depth--;
          default:
        }
        // The condition of `#if` and `#elseif` runs to the end of the line
        // or of its parentheses; skip to the end of the line.
        while (index < length
          && StringTools.fastCodeAt(text, index) != '\n'.code)
          index++;
        continue;
      }
      final keyword = word();
      switch keyword {
        case 'package':
          statement();
        case 'import' | 'using':
          result.push({
            keyword: keyword,
            path: statement(),
            conditional: depth > 0
          });
        case '':
          // Not a name: metadata or another token starts a declaration.
          break;
        default:
          break;
      }
    }
    return result;
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}

/**
 * One walk of `DceStdUses.usesOf` over one module: the port of the marking
 * functions of Haxe 4.3.7's `dce.ml`, with the lines found so far. Each
 * method names the OCaml function that it follows.
 *
 * Why a class: the marking functions call each other (`mark_class` follows
 * an initializer with `expr`, `expr` marks types with `mark_t`, `mark_t`
 * marks classes), and the walk keeps sets of what it marked, as Haxe keeps
 * `@:used` marks. Marking one declaration or field twice adds nothing, so
 * each is followed once.
 */
private class DceStdWalk {
  /** The module of the walked declarations; marks of its own fields add no line. */
  final module: String;

  final lines = new Map<String, Bool>();
  final markedClasses = new Map<String, Bool>();
  final markedEnums = new Map<String, Bool>();
  final markedAbstracts = new Map<String, Bool>();
  final markedFields = new Map<String, Bool>();

  /** The types that `markType` is walking now (`t_stack`). */
  final typeStack: Array<String> = [];

  /** The typedefs that `toStringOf` is expanding now (`ts_stack`). */
  final stringStack: Array<String> = [];

  /**
   * The deepest nesting that the walk follows. Haxe has no such limit; a
   * walk that reaches it writes an `unknown` line instead of dropping the
   * marks below it, and the rule then refuses (`dce-uses-unknown`).
   */
  static inline final LIMIT = 64;

  public function new(module: String) {
    this.module = module;
  }

  /** Returns the lines found, sorted. */
  public function result(): Array<String> {
    final found = [for (line in lines.keys()) line];
    found.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    return found;
  }

  /**
   * Walks one class of the module as `collect_entry_points` and `mark` do
   * for a class that is kept whole: every field, its type and its body, the
   * class initializer, and the class itself when it has a physical field.
   */
  public function entry(cls: ClassType): Void {
    if (cls.kind.match(KTypeParameter(_)))
      return;
    // `collect_entry_points` also marks fields of an extern class: every
    // field of an extern interface, and each field that `keep_field` keeps
    // (`@:keep`, `@:expose`, an extern field). The walk marks the types of
    // every field of an extern class, which is never fewer; it follows no
    // body of one, as `mark` does not. Example: `@:keep static function
    // b(): haxe.ds.List<Int>;` in an extern class keeps `haxe.ds.List`.
    final externClass = cls.isExtern;
    final fields = cls.statics.get().concat(cls.fields.get());
    final constructor = cls.constructor;
    if (constructor != null)
      fields.push(constructor.get());
    // The `mark` loop marks the class of each physical field, which keeps
    // its parent class and interfaces.
    for (field in fields)
      if (DceStdUses.isPhysicalField(field)) {
        markClass(cls);
        break;
      }
    // `collect_entry_points` marks the constructor with `mark_field`, which
    // keeps the constructor of every parent class, also of one in another
    // module.
    if (constructor != null)
      markField(cls, constructor.get(), false);
    for (field in fields) {
      markType(field.type);
      if (externClass)
        continue;
      genes.incremental.RequestMeasure.bodyRead(field);
      final body = field.expr();
      if (body != null)
        expr(body);
      for (signature in field.overloads.get()) {
        genes.incremental.RequestMeasure.bodyRead(signature);
        final other = signature.expr();
        if (other != null)
          expr(other);
      }
    }
    final init = cls.init;
    if (init != null)
      expr(init);
  }

  function feature(name: String): Void {
    lines.set('feature $name', true);
  }

  /** Writes that the walk stopped at `LIMIT` and may have missed marks. */
  function unknown(reason: String): Void {
    lines.set('unknown $reason', true);
  }

  /** `s_type_path`: the package and name of a declaration, without its module. */
  static function pathOf(base: BaseType): String {
    return base.pack.concat([base.name]).join('.');
  }

  /** `mark_class` with `update_marked_class_fields`. */
  function markClass(cls: ClassType): Void {
    final key = TypeUtil.baseTypeFullName(cls);
    if (markedClasses.exists(key))
      return;
    markedClasses.set(key, true);
    if (DceStdUses.eligibleClass(cls))
      lines.set('keep ${cls.module} class $key', true);
    feature('${pathOf(cls)}.*');
    // The initializer of a class that is kept whole was followed at its
    // entry; an extern class's is followed only here.
    if (cls.isExtern) {
      final init = cls.init;
      if (init != null)
        expr(init);
    }
    // The parent class and the interfaces are kept with the class.
    for (item in cls.interfaces)
      markClass(item.t.get());
    final parent = cls.superClass;
    if (parent != null)
      markClass(parent.t.get());
  }

  /** `mark_enum`. */
  public function markEnum(enm: EnumType): Void {
    final key = TypeUtil.baseTypeFullName(enm);
    if (markedEnums.exists(key))
      return;
    markedEnums.set(key, true);
    if (DceStdUses.eligibleEnum(enm))
      lines.set('keep ${enm.module} enum $key', true);
    feature('has_enum');
    feature('${pathOf(enm)}.*');
    for (name in enm.names) {
      final construct = enm.constructs.get(name);
      if (construct != null)
        markType(construct.type);
    }
  }

  /** `mark_abstract`. */
  function markAbstract(abs: AbstractType): Void {
    final key = TypeUtil.baseTypeFullName(abs);
    if (markedAbstracts.exists(key))
      return;
    markedAbstracts.set(key, true);
    feature('${pathOf(abs)}.*');
  }

  /**
   * `mark_t`. A stack guards recursive types, as `t_stack` does. A type is
   * walked again in another place, because the constraints of a type
   * parameter depend on its owner, which the printed type does not hold.
   */
  function markType(value: Type): Void {
    final text = TypeTools.toString(value);
    if (typeStack.indexOf(text) >= 0)
      return;
    if (typeStack.length > LIMIT) {
      unknown('a type nested deeper than $LIMIT levels: $text');
      return;
    }
    typeStack.push(text);
    switch Context.follow(value) {
      case TInst(owner, params):
        final cls = owner.get();
        switch cls.kind {
          case KTypeParameter(constraints):
            for (constraint in constraints)
              markType(constraint);
          default:
            markClass(cls);
        }
        for (param in params)
          markType(param);
      case TFun(args, result):
        for (arg in args)
          markType(arg.t);
        markType(result);
      case TEnum(owner, params):
        markEnum(owner.get());
        for (param in params)
          markType(param);
      case TAbstract(owner, params):
        final abs = owner.get();
        if (abs.meta.has(':multiType')) {
          // Haxe marks a specialization (`find_multitype_specialization`)
          // that a macro cannot compute; name the abstract and its
          // arguments instead.
          lines.set('multitype ${TypeUtil.baseTypeFullName(abs)} '
            + [for (param in params) TypeTools.toString(param)].join(','),
            true);
        } else {
          markAbstract(abs);
          for (param in params)
            markType(param);
          if (!abs.meta.has(':coreType'))
            markType(abs.type.applyTypeParameters(abs.params, params));
        }
      default:
    }
    typeStack.pop();
  }

  /** `mark_mt`. */
  function markModuleType(declaration: ModuleType): Void {
    switch declaration {
      case TClassDecl(reference):
        markClass(reference.get());
      case TEnumDecl(reference):
        markEnum(reference.get());
      case TAbstract(reference):
        // `mark_mt` also sets `@:valueUsed`, the only mark that answers
        // `hasFeature("<abstract>.*")`; a type use does not set it. Example:
        // `return Int;` makes `Std.__init__` print `var Int = { };`.
        final abs = reference.get();
        markAbstract(abs);
        lines.set('value ${pathOf(abs)}.*', true);
      case TTypeDecl(_):
    }
  }

  /**
   * `mark_field`: the field is kept in the class that declares it; a kept
   * physical instance field also keeps the constructor of its class, and a
   * kept constructor keeps the constructors of the parent classes.
   */
  function markField(cls: ClassType, field: ClassField, isStatic: Bool): Void {
    if (field.name == 'new') {
      var current: Null<ClassType> = cls;
      var depth = 0;
      while (current != null) {
        if (depth++ > LIMIT) {
          unknown('a parent chain longer than $LIMIT above ${TypeUtil.baseTypeFullName(cls)}');
          return;
        }
        final constructor = current.constructor;
        if (constructor != null)
          addField(current, constructor.get(), false);
        final parent = current.superClass;
        current = parent == null ? null : parent.t.get();
      }
      return;
    }
    final declared = (isStatic ? cls.statics.get() : cls.fields.get())
      .filter(item -> item.name == field.name)
      .length > 0;
    final parent = cls.superClass;
    if (!declared && parent != null)
      markField(parent.t.get(), field, isStatic);
    else
      addField(cls, field, isStatic);
    if (!isStatic && DceStdUses.isPhysicalField(field)) {
      final constructor = cls.constructor;
      if (constructor != null)
        markField(cls, constructor.get(), false);
    }
  }

  /** `add` of `mark_field`, for a field that the module does not own. */
  function addField(cls: ClassType, field: ClassField, isStatic: Bool): Void {
    if (cls.module == module)
      return;
    final label = field.name == 'new' ? 'new' : (isStatic ? 's:' : 'i:')
      + field.name;
    final key = '${TypeUtil.baseTypeFullName(cls)} $label';
    if (markedFields.exists(key))
      return;
    markedFields.set(key, true);
    if (DceStdUses.eligibleClass(cls))
      lines.set('keep ${cls.module} class $key', true);
    // A first mark of a field of an extern class or interface also marks the
    // overriding fields of its subclasses (`mark_dependent_fields`), and such
    // a subclass can be one that dead-code elimination may change
    // (`haxe.Exception` extends `js.lib.Error`; `DceStdUses.externBasesOf`).
    if (cls.isExtern)
      lines.set('dependent $key', true);
    feature('${pathOf(cls)}.${field.name}');
  }

  /**
   * `field`: finds a field by name in the class, its interfaces, its parent
   * classes or the constraints of a type parameter, and marks it.
   */
  function fieldByName(cls: ClassType, name: String, isStatic: Bool,
      depth: Int): Bool {
    if (depth > LIMIT) {
      unknown('a field lookup deeper than $LIMIT levels: ${TypeUtil.baseTypeFullName(cls)}.$name');
      return false;
    }
    final found = if (name == 'new') {
      final constructor = cls.constructor;
      constructor == null ? null : constructor.get();
    } else {
      final list = (isStatic ? cls.statics.get() : cls.fields.get())
        .filter(item -> item.name == name);
      list.length == 0 ? null : list[0];
    }
    if (found != null) {
      markField(cls, found, isStatic);
      return true;
    }
    if (cls.isInterface) {
      for (item in cls.interfaces)
        if (fieldByName(item.t.get(), name, isStatic, depth + 1))
          return true;
    } else {
      final parent = cls.superClass;
      if (parent != null
        && fieldByName(parent.t.get(), name, isStatic, depth + 1))
        return true;
    }
    switch cls.kind {
      case KTypeParameter(constraints):
        for (constraint in constraints)
          switch constraint {
            case TInst(owner, _):
              if (fieldByName(owner.get(), name, isStatic,
                depth + 1)) return true;
            default:
          }
      default:
    }
    return false;
  }

  /** `to_string`: `Std.string`, `trace` and `throw` keep `toString`. */
  function toStringOf(value: Type): Void {
    switch value {
      case TInst(owner, _):
        fieldByName(owner.get(), 'toString', false, 0);
      case TType(owner, params):
        final text = TypeTools.toString(value);
        if (stringStack.indexOf(text) >= 0)
          return;
        if (stringStack.length > LIMIT) {
          unknown('a typedef chain longer than $LIMIT: $text');
          return;
        }
        stringStack.push(text);
        final def = owner.get();
        toStringOf(def.type.applyTypeParameters(def.params, params));
        stringStack.pop();
      case TAbstract(owner, params):
        final abs = owner.get();
        final impl = abs.impl;
        if (impl == null)
          return;
        if (abs.meta.has(':coreType'))
          fieldByName(impl.get(), 'toString', false, 0);
        else
          toStringOf(abs.type.applyTypeParameters(abs.params, params));
      case TMono(reference):
        final bound = reference.get();
        if (bound != null)
          toStringOf(bound);
      case TLazy(force):
        toStringOf(force());
      case TDynamic(inner):
        if (inner != null)
          toStringOf(inner);
      default:
    }
  }

  static function fieldName(access: FieldAccess): String {
    return switch access {
      case FInstance(_, _, field) | FStatic(_, field) | FAnon(field) |
        FClosure(_, field): field.get().name;
      case FDynamic(name): name;
      case FEnum(_, field): field.name;
    }
  }

  /** `expr_field` (its call flag changes only Python output). */
  function exprField(object: TypedExpr, access: FieldAccess): Void {
    switch access {
      case FStatic(owner, field):
        final cls = owner.get();
        markClass(cls);
        markField(cls, field.get(), true);
      case FInstance(owner, _, field):
        final cls = owner.get();
        markClass(cls);
        markField(cls, field.get(), false);
      default:
        final name = fieldName(access);
        switch access {
          case FAnon(_):
            // Haxe picks the optional or the plain feature from the field's
            // `@:optional`; both are written.
            feature('anon_optional_read');
            feature('anon_optional_read.$name');
            feature('anon_read');
            feature('anon_read.$name');
          case FDynamic(_):
            feature('dynamic_read');
            feature('dynamic_read.$name');
          case FClosure(_, _):
            feature('closure_read');
            feature('closure_read.$name');
          default:
        }
        final closureOwner = switch access {
          case FClosure(owner, _) if (owner != null): owner.c.get();
          default: null;
        }
        switch Context.follow(object.t) {
          case TInst(owner, _):
            final cls = owner.get();
            markClass(cls);
            fieldByName(cls, name, false, 0);
          case TAnonymous(anon) if (closureOwner == null):
            switch anon.get().status {
              case AClassStatics(owner):
                final cls = owner.get();
                markClass(cls);
                fieldByName(cls, name, true, 0);
              default:
            }
          default:
            if (closureOwner != null) {
              markClass(closureOwner);
              fieldByName(closureOwner, name, false, 0);
            }
        }
    }
    expr(object);
  }

  /** `check_op`. */
  function checkOp(op: Binop): Void {
    switch op {
      case OpMod:
        feature('binop_%');
      case OpUShr:
        feature('binop_>>>');
      case OpAssignOp(inner):
        checkOp(inner);
      default:
    }
  }

  /** True when `expression` is the static field `field` of the class `pack.name`. */
  static function isStaticOf(expression: TypedExpr, pack: String,
      name: String, field: String): Bool {
    return switch expression.expr {
      case TField({expr: TTypeExpr(TClassDecl(owner))}, FStatic(_, member)): final cls = owner.get(); cls.pack.join('.') == pack && cls.name == name && member.get()
          .name == field;
      default: false;
    }
  }

  /** `expr`, in the order of its cases. */
  function expr(expression: TypedExpr): Void {
    markType(expression.t);
    switch expression.expr {
      case TNew(owner, params, args):
        final cls = owner.get();
        markClass(cls);
        fieldByName(cls, 'new', false, 0);
        for (arg in args)
          expr(arg);
        for (param in params)
          markType(param);
      case TVar(variable, value):
        if (value != null)
          expr(value);
        markType(variable.t);
      case TCast(value, declaration) if (declaration != null):
        feature('typed_cast');
        markModuleType(declaration);
        expr(value);
      case TObjectDecl(fields):
        feature('has_anon');
        for (field in fields)
          expr(field.expr);
      case TTypeExpr(declaration):
        markModuleType(declaration);
      case TTry(body, catches):
        expr(body);
        for (item in catches) {
          // Haxe checks `typed_catch` unless the variable is `Dynamic`.
          feature('typed_catch');
          expr(item.expr);
          markType(item.v.t);
        }
      case TCall({expr: TIdent('`trace')},
        [position, {expr: TObjectDecl(fields)}]):
        feature('has_anon_trace');
        for (field in fields)
          expr(field.expr);
        expr(position);
      case TCall({expr: TIdent('__define_feature__')},
        [{expr: TConst(TString(name))}, value]):
        feature(name);
        expr(value);
      case TCall(callee = {expr: TField(_, FInstance(owner, params, field))},
        args)
        if (field.get().name == 'join' && owner.get().pack.length == 0
          && owner.get().name == 'Array'):
        // `array.join()` keeps `toString` of the element type.
        for (param in params)
          toStringOf(param);
        expr(callee);
        for (arg in args)
          expr(arg);
      case TCall(callee, args)
        if (args.length > 0
          && (isStaticOf(callee, 'haxe', 'Log', 'trace')
            || isStaticOf(callee, '', 'Std', 'string'))):
        switch callee.expr {
          case TField({expr: TTypeExpr(TClassDecl(owner))}, _):
            markClass(owner.get());
          default:
        }
        toStringOf(args[0].t);
        if (args.length == 2)
          switch args[1].expr {
            case TObjectDecl(fields):
              for (field in fields)
                if (field.name == 'customParams')
                  switch field.expr.expr {
                    case TArrayDecl(values):
                      for (value in values)
                        toStringOf(value.t);
                    default:
                  }
            default:
          }
        expr(callee);
        for (arg in args)
          expr(arg);
      case TCall(callee = {expr: TConst(TSuper)}, args):
        markType(callee.t);
        for (arg in args)
          expr(arg);
      case TUnop(OpIncrement | OpDecrement, _, target = {expr: TArray(_, _)}):
        feature('array_write');
        feature('array_read');
        expr(target);
      case TBinop(op, left, right):
        binop(op, left, right);
      case TArray(left, right):
        // `dynamic_array_read` for `Dynamic`, `array_read` for an array.
        feature('dynamic_array_read');
        feature('array_read');
        expr(left);
        expr(right);
      case TCall(callee = {expr: TField(object, access)}, args):
        markType(callee.t);
        exprField(object, access);
        for (arg in args)
          expr(arg);
      case TField(object, access):
        exprField(object, access);
      case TThrow(value):
        feature('has_throw');
        expr(value);
        throwStrings(value);
      default:
        genes.incremental.RequestMeasure.factNode();
        TypedExprTools.iter(expression, expr);
    }
  }

  /** The `to_string` loop of the `throw` case: every part of the thrown value. */
  function throwStrings(item: TypedExpr): Void {
    toStringOf(item.t);
    genes.incremental.RequestMeasure.factNode();
    TypedExprTools.iter(item, throwStrings);
  }

  /**
   * The binary cases of `expr`. Haxe picks one case from type tests; this
   * writes the features of every case that the form can match, then walks
   * both sides, as each case does.
   */
  function binop(op: Binop, left: TypedExpr, right: TypedExpr): Void {
    final assigns = switch op {
      case OpAssign | OpAssignOp(_): true;
      default: false;
    }
    switch op {
      case OpAdd | OpAssignOp(OpAdd):
        feature('add_dynamic');
        feature('unsafe_string_concat');
      case OpEq:
        feature('dynamic_binop_==');
        feature('type_param_binop_==');
      case OpNotEq:
        feature('dynamic_binop_!=');
        feature('type_param_binop_!=');
      default:
    }
    if (assigns)
      switch left.expr {
        case TArray(_, _):
          feature('array_write');
          feature('dynamic_array_write');
        case TField(_, FDynamic(name)):
          feature('dynamic_write');
          feature('dynamic_write.$name');
        case TField(_, FAnon(field)):
          final name = field.get().name;
          feature('anon_write');
          feature('anon_write.$name');
          feature('anon_optional_write');
          feature('anon_optional_write.$name');
        default:
      }
    checkOp(op);
    expr(left);
    expr(right);
  }
}
#end
