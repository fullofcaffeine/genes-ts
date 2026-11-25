package genes.incremental;

#if macro
import haxe.io.Path;
import haxe.macro.Compiler;
import haxe.macro.Context;
import haxe.macro.Type;
import sys.FileSystem;
import sys.io.File;
import genes.util.PathUtil;

/**
 * Haxe's own list of the modules that each module makes it load, for the
 * `module-may-leave` rule of a module request (`ModuleRequest`,
 * genes-f8vc.14.26).
 *
 * Why: under `-dce std` a module stays in the program, and keeps its output
 * file, as long as a module that stays loads it. `DceStdUses.dependenciesOf`
 * reads the typed bodies, but Haxe types some references away:
 *
 * - an inline function call: `Json.checkedValue` calls the inline
 *   `JsonCodec.unsafeAssumeJson(value)`, and the typed body holds only
 *   `value`;
 * - an inline constant: `GraphReferenceCard.CitationProperty` becomes the
 *   string `'citation'`;
 * - a macro call: `genes.ts.TypeArguments.call(...)` becomes the code that
 *   the macro returns.
 *
 * Haxe still loads the callee's module, and a full build writes its file.
 * Without these edges no module that stays was known to load it, so every
 * `-dce std` module request of such a program was refused (Caffeine: 0 of
 * 18 edits previewed).
 *
 * What: Haxe keeps, for each module, the modules that it loaded while it
 * typed it (`m_deps`). Its compilation server adds them back with the
 * module when it reuses the module from its cache (`add_modules` in
 * `server.ml`), so a module of that list stays loaded while its dependent
 * does. Haxe 4.3.7 gives macros no call that reads the list, but
 * `-D dump-dependencies` writes it to `<dump-path>/js/dependencies.dump`
 * before it calls the generator (`generate.ml`). Neither define is part of
 * the compilation signature except `dump-path`, which `prepare` keeps the
 * same for every request of one process, so the module cache stays shared.
 *
 * How: `prepare` sets the defines; `noteModules` reads, before dead-code
 * elimination, the facts that tell whether a line can be trusted; `edges`
 * reads the file once in the generator and returns, by module, each
 * dependency that names another module of the program.
 *
 * The file names a module by its file, and three kinds of module can have
 * the file of a program module `X`: `X` itself, the module of `X` in Haxe's
 * macro context (when the dependent called a macro of a class of `X`), and
 * a module that a macro made for that file (`Context.defineType` and
 * `defineModule` depend on the module whose file they take, so the edge is
 * true through it; `registerModuleDependency` with a `.hx` file of the
 * program is the one exception, see Limits). A line counts as "the
 * dependent loads `X`" when:
 *
 * - the file is the file of exactly one module of the program, and that
 *   file ends with the module's path (`app/ui/Card.hx` for `app.ui.Card`);
 * - and either the file is listed twice for the dependent (two modules of
 *   one file: a macro call on a class of `X` also resolves the class in
 *   the program first, so the second module is `X`), or `X` has no macro
 *   function, the dependent ran no build macro (`@:build`, also from
 *   `@:autoBuild` or `addGlobalMetadata`), and no class of the program has
 *   `@:genericBuild`. A macro module that the dependent loaded without `X`
 *   comes only from such a call (`load_macro'` in `macroContext.ml`, called
 *   for expression macros, build macros and generic builds).
 *
 * Example: `genes/ts/Json.hx` lists `genes/ts/JsonCodec.hx` once;
 * `genes.ts.JsonCodec` has no macro function and `genes.ts.Json` has no
 * build macro, so `genes.ts.Json` loads `genes.ts.JsonCodec`. A module that
 * calls `TypeArguments.call` lists `genes/ts/TypeArguments.hx` twice.
 *
 * Why it is safe: an edge only lets the rule count one more module as
 * staying, so a wrong edge could hide a module that leaves. Every edge
 * above is a module that Haxe loads with its dependent. A line that does
 * not pass is dropped, which can only refuse a preview.
 *
 * Limits: a macro that calls `Context.registerModuleDependency` with the
 * `.hx` file of a program module gives a line that this class takes for that
 * module. When the session sets `dump-path` or `dump-dependencies` itself,
 * Genes reads that folder and leaves its files; two Haxe processes that
 * build with that same folder at the same time can then read each other's
 * file.
 */
class HaxeDependencies {
  /** The start of the environment variable that holds this process's dump folder name (`prepare`). */
  static inline final FOLDER_VARIABLE = 'GENES_HAXE_DEPENDENCIES_';

  /** The folder of this request's dump, or `null` when `prepare` did not run. */
  static var folder: Null<String> = null;

  /** True when Genes chose `folder` and may delete its files after reading them. */
  static var owned = false;

  /** The edges of this request (`edges`), once read. */
  static var read: Null<Map<String, Array<String>>> = null;

  /**
   * The facts of each module that `edges` needs, by module, with the
   * epochs that they were read for (`GenerationChangeSet.epochs`), so a
   * module that Haxe did not type again is not walked again.
   */
  @:persistent static var noted: Map<String, ModuleMacroFacts> = new Map();

  /** True when a class of the program of the last full request had `@:genericBuild` (`noteModules`). */
  @:persistent static var storedGenericBuild = false;

  /** True when a class of this request's program has `@:genericBuild`. */
  static var genericBuild = false;

  /** The modules of this request with their files (`noteModules`). */
  static var files: Map<String, String> = new Map();

  /** The facts of each module of this request (`noteModules`). */
  static var facts: Map<String, ModuleMacroFacts> = new Map();

  /**
   * Makes Haxe write its dependency list for this request when `wanted`
   * (a `-dce std` full request with module records, or a `-dce std` module
   * request), and
   * deletes the list of an earlier request. `ModuleRequest.begin` calls it
   * in every request with the incremental define, before Genes reads the
   * defines (`ModuleRequest.definesKey`).
   *
   * The folder is `<descriptor>.haxe-dependencies/<name>`, beside the
   * descriptor and never in the output tree. `dump-path` is part of
   * Haxe's compilation signature, so it is set in every request, also when
   * no list is wanted, and `<name>` is kept in the process environment: it
   * stays the same for the life of one Haxe process, so every request of a
   * session shares one module cache, and another process with the same
   * descriptor (a cold build) writes into its own folder.
   *
   * When the session sets `dump-path` or `dump-dependencies` itself, Genes
   * changes neither of them, only adds `dump-dependencies` when it wants
   * the list, and never deletes the files.
   */
  public static function prepare(descriptorPath: String, wanted: Bool): Void {
    read = null;
    files = new Map();
    facts = new Map();
    genericBuild = false;
    folder = null;
    owned = false;
    if (Context.defined('dump-path') || Context.defined('dump-dependencies')) {
      if (!wanted)
        return;
      if (!Context.defined('dump-dependencies'))
        Compiler.define('dump-dependencies');
      folder = Context.definedValue('dump-path') ?? 'dump';
      return;
    }
    final variable = FOLDER_VARIABLE
      + haxe.crypto.Sha1.encode(descriptorPath).substr(0, 16);
    var name = Sys.getEnv(variable);
    if (name == null || name.length == 0) {
      name = haxe.crypto.Sha1.encode(Std.string(Sys.time())
        + ':'
        + Std.string(Std.random(0x3FFFFFFF))
        + ':'
        + Std.string(Std.random(0x3FFFFFFF)))
        .substr(0, 16);
      Sys.putEnv(variable, name);
    }
    final chosen = '$descriptorPath.haxe-dependencies/$name';
    Compiler.define('dump-path', chosen);
    folder = chosen;
    owned = true;
    removeFiles();
    if (!wanted) {
      folder = null;
      return;
    }
    Compiler.define('dump-dependencies');
    // Haxe 4.3.7 makes only the folders below `dump-path`, not the folders
    // that the path itself names.
    try
      FileSystem.createDirectory(chosen)
    catch (_:haxe.Exception) {}
  }

  /**
   * Notes the facts of the modules of this request that `edges` needs:
   * each module's file, whether it has a macro function, whether it ran a
   * build macro, and whether a class has `@:genericBuild`. `grouped` holds
   * every declaration by module, before dead-code elimination (which can
   * remove a macro function); `moduleFiles` holds each module's file.
   * `ModuleRequest.afterSaveSteps` calls it.
   */
  public static function noteModules(grouped: Map<String, Array<Type>>,
      moduleFiles: Map<String, String>, full: Bool): Void {
    files = moduleFiles;
    facts = new Map();
    var generic = false;
    for (module => types in grouped) {
      final epochs = GenerationChangeSet.epochs(module);
      final known = noted.get(module);
      final own = if (known != null && epochs.length > 0
        && known.epochs == epochs) known else {
        final made = macroFactsOf(types, epochs);
        if (epochs.length > 0)
          noted.set(module, made);
        made;
      }
      facts.set(module, own);
      if (own.genericBuild)
        generic = true;
    }
    // A module request sees only its own part of the program: a class with
    // `@:genericBuild` elsewhere counts from the last full request, so the
    // requested module's edges are the ones that a full request finds.
    genericBuild = generic || (!full && storedGenericBuild);
    if (full)
      storedGenericBuild = generic;
  }

  /**
   * Returns the module facts of one module's declarations `types`.
   * Example: a class with `public static macro function twice(...)` gives
   * `macroFunction`; a class with `@:build(app.Model.build())`, also one
   * that Haxe gave it from a parent's `@:autoBuild`, gives `buildMacro`.
   */
  static function macroFactsOf(types: Array<Type>,
      epochs: String): ModuleMacroFacts {
    var macroFunction = false;
    var buildMacro = false;
    var generic = false;
    function inClass(cls: ClassType): Void {
      if (cls.meta.has(':build'))
        buildMacro = true;
      if (cls.meta.has(':genericBuild') || cls.kind.match(KGenericBuild))
        generic = true;
      for (field in cls.statics.get().concat(cls.fields.get()))
        if (field.kind.match(FMethod(MethMacro)))
          macroFunction = true;
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          inClass(reference.get());
        case TEnum(reference, _):
          if (reference.get().meta.has(':build'))
            buildMacro = true;
        case TAbstract(reference, _):
          final abs = reference.get();
          if (abs.meta.has(':build'))
            buildMacro = true;
          final impl = abs.impl;
          if (impl != null)
            inClass(impl.get());
        default:
      }
    return {
      epochs: epochs,
      macroFunction: macroFunction,
      buildMacro: buildMacro,
      genericBuild: generic
    };
  }

  /**
   * Returns Haxe's dependencies of the modules of this request that count
   * (see the class comment), by module, each list sorted; an empty map when
   * Haxe wrote no list (the request did not generate, or the file cannot be
   * read). Reads the file once per request, in the generator, after Haxe
   * wrote it, and deletes Genes' own files.
   *
   * Example: `{"genes.ts.Json" => ["genes.ts.JsonCodec", ...]}`.
   */
  public static function edges(): Map<String, Array<String>> {
    final known = read;
    if (known != null)
      return known;
    final result = new Map<String, Array<String>>();
    read = result;
    final base = folder;
    if (base == null)
      return result;
    final file = Path.join([base, 'js', 'dependencies.dump']);
    final text = try File.getContent(file) catch (_:haxe.Exception) null;
    if (owned)
      removeFiles();
    if (text == null)
      return result;
    // The module of each file: exactly one module of the program, whose
    // path the file ends with.
    final byFile = new Map<String, String>();
    final shared = new Map<String, Bool>();
    for (module => source in files) {
      // A module of Haxe's standard library is left out as a dependency:
      // Haxe adds some of them to whichever class it is typing at the time
      // (`haxe.Exception` in `exceptions.ml`), so the line depends on the
      // order of a request, and dead-code elimination, not loading, decides
      // whether such a module has a file.
      if (DceStdUses.isStdFile(source))
        continue;
      final full = fullPath(source);
      if (!StringTools.endsWith(full,
        '/' + module.split('.').join('/') + '.hx'))
        continue;
      if (byFile.exists(full))
        shared.set(full, true);
      byFile.set(full, module);
    }
    for (full in shared.keys())
      byFile.remove(full);
    var current: Null<String> = null;
    var counts = new Map<String, Int>();
    function finish(): Void {
      final module = current;
      if (module == null)
        return;
      final own = facts.get(module);
      final trustOnce = own != null && !own.buildMacro && !genericBuild;
      final found = [];
      for (dependency => count in counts) {
        if (dependency == module)
          continue;
        final other = facts.get(dependency);
        if (count >= 2 || (trustOnce && other != null && !other.macroFunction))
          found.push(dependency);
      }
      found.sort(compareStrings);
      result.set(module, found);
    }
    for (line in text.split('\n')) {
      if (line.length == 0)
        continue;
      if (StringTools.fastCodeAt(line, 0) == '\t'.code) {
        if (current == null)
          continue;
        final dependency = byFile.get(line.substr(1));
        if (dependency != null)
          counts.set(dependency, (counts.get(dependency) ?? 0) + 1);
        continue;
      }
      finish();
      counts = new Map();
      current = StringTools.endsWith(line,
        ':') ? byFile.get(line.substr(0, line.length - 1)) : null;
    }
    finish();
    return result;
  }

  /**
   * Returns true when `module` has a macro function (see `noteModules`).
   * `ModuleRequest` asks it for a dependency that only Haxe's list names,
   * to know whether that module is a project macro module.
   */
  public static function hasMacroFunction(module: String): Bool {
    final own = facts.get(module);
    return own != null && own.macroFunction;
  }

  /**
   * Returns `file` as Haxe 4.3.7 writes it in the list (`Path.get_full_path`
   * on Unix): absolute, with `.` and `..` resolved, symbolic links kept.
   */
  static function fullPath(file: String): String {
    return PathUtil.normalize(FileSystem.absolutePath(file));
  }

  /**
   * Deletes the files that Haxe writes into Genes' own dump folder, and the
   * empty folders, so an old list is never read and no large file stays
   * beside the descriptor.
   */
  static function removeFiles(): Void {
    final base = folder;
    if (base == null || !owned)
      return;
    for (target in ['js', 'macro']) {
      final dir = Path.join([base, target]);
      for (name in ['dependencies.dump', 'dependants.dump']) {
        final file = Path.join([dir, name]);
        try {
          if (FileSystem.exists(file))
            FileSystem.deleteFile(file);
        } catch (_:haxe.Exception) {}
      }
      try {
        if (FileSystem.exists(dir))
          FileSystem.deleteDirectory(dir);
      } catch (_:haxe.Exception) {}
    }
    // The folder of this process, then the folder of every process of the
    // descriptor; each is deleted only when it is empty.
    for (dir in [base, Path.directory(base)])
      try {
        if (FileSystem.exists(dir))
          FileSystem.deleteDirectory(dir);
      } catch (_:haxe.Exception) {}
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}

/** The facts of one module that tell whether a line of Haxe's list can be trusted (`HaxeDependencies`). */
typedef ModuleMacroFacts = {
  /** `GenerationChangeSet.epochs` of the module when the facts were read. */
  final epochs: String;

  /** True when a class of the module (also an abstract's implementation) has a macro function. */
  final macroFunction: Bool;

  /** True when a class, enum or abstract of the module has `@:build` (Haxe adds it for `@:autoBuild`). */
  final buildMacro: Bool;

  /** True when a class of the module has `@:genericBuild`. */
  final genericBuild: Bool;
}
#end
