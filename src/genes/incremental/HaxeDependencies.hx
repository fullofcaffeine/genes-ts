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
 * typed it (`m_deps`). Its compilation server adds the program modules of
 * that list back with the module when it reuses the module from its cache
 * (`add_modules` in `server.ml`), so such a module stays loaded while its
 * dependent does. Haxe 4.3.7 gives macros no call that reads the list, but
 * `-D dump-dependencies` writes it before Haxe calls the generator
 * (`generate.ml`): `<dump-path>/js/dependencies.dump` for the program and a
 * `macro/dependencies.dump` for Haxe's macro context. Only `dump-path` is
 * part of the compilation signature; `prepare` keeps it the same for every
 * request of one process, so the module cache stays shared. Haxe copies the
 * defines into its macro context before any init macro runs, so the macro
 * list goes to the `dump-path` of the command line, else to `dump` in the
 * working folder, which Genes then reads and deletes.
 *
 * How: `prepare` sets the defines; `noteModules` reads, before dead-code
 * elimination, which modules have a macro function; `edges` reads both
 * lists once in the generator and returns, by module, each dependency that
 * counts.
 *
 * The list names a module by its file, and four kinds of module can have
 * the file `F` of a program module `X`: `X` itself; the module of `F` in
 * Haxe's macro context, when the dependent called a macro of a class of `F`
 * (`load_macro'` in `macroContext.ml`: expression macros, build macros and
 * generic builds); a module that `Context.registerModuleDependency` made for
 * `F` (`create_fake_module`); and a module that a macro defined with the
 * file of `F` (`Context.defineType`, `defineModule`). Haxe adds the last
 * two to the program's list with their dependent (`module_lut`), so they
 * show as a second entry `F:` of the program's list; a macro module never
 * does. A line `F` of a dependent `A` counts as "`A` loads `X`" when:
 *
 * - `F` is the file of exactly one module `X` of the program, `F` ends with
 *   that module's path, `X` is not in Haxe's standard library (see
 *   `collect`), and `F` is an entry of the program's list exactly once;
 * - and either `X` has a macro function and `F` is listed at least twice
 *   for `A` (a macro module and `X` itself: a macro call also resolves the
 *   class of `X` in the program), or `X` has no macro function and `F` was
 *   not a module of Haxe's macro context in the request that typed `A`.
 *   Haxe loads each macro module of `A` in the request that types `A` and
 *   adds its types to the macro interpreter (`flush_macro_context`), which
 *   keeps them while it lives. So `F` counts as a macro module when a class
 *   or enum of `X` is known to the interpreter (`Type.resolveClass`), or
 *   when `F` is an entry of the macro list (which can only add files, also
 *   when another process wrote that shared file). Genes keeps this fact for each
 *   module by the digest of its epochs (`GenerationChangeSet.epochs`), also
 *   in a file beside the descriptor that outlives a new macro state of
 *   Genes, because a later request reuses `A` from Haxe's cache without
 *   loading its macro modules again. When the fact is not known (Haxe typed
 *   `A` in a request without the list, such as an editor request), the line
 *   does not count.
 *
 * Example: `genes/ts/Json.hx` lists `genes/ts/JsonCodec.hx` once;
 * `genes.ts.JsonCodec` has no macro function and was no macro module when
 * Haxe typed `genes.ts.Json`, so `genes.ts.Json` loads `genes.ts.JsonCodec`.
 * A module that calls `TypeArguments.call` lists
 * `genes/ts/TypeArguments.hx` twice, and `TypeArguments` has a macro
 * function. A class with `@:build(mr.reach.Model.build())` lists
 * `mr/reach/Model.hx` once, also when the build macro removes its own
 * metadata, and that file was a macro module in the request that typed the
 * class, so the line does not count.
 *
 * Why it is safe: an edge only lets the rule count one more module as
 * staying, so a wrong edge could hide a module that leaves. Every edge
 * above is a program module that Haxe loads with its dependent. A line
 * that does not pass is dropped, which can only refuse a preview.
 *
 * Limits: when the session sets `dump-path` or `dump-dependencies` itself,
 * Genes reads that folder and leaves its files; two Haxe processes that
 * build with that same folder at the same time can then read each other's
 * program list. Haxe also writes `dependants.dump` for both contexts, which
 * Genes does not read; Haxe 4.3.7 has no define that leaves it out. Without
 * a session `dump-path`, Haxe writes the macro list into `dump/macro` of the
 * working folder; Genes deletes those files and the folders when empty, and
 * a second Genes process of the same folder that writes at that moment can
 * fail its request (no wrong output). A module that Haxe typed in a request
 * without the list (an editor request) counts no single line until Haxe
 * types it again in a request with the list.
 */
class HaxeDependencies {
  /** The start of the environment variable that holds this process's dump folder name (`prepare`). */
  static inline final FOLDER_VARIABLE = 'GENES_HAXE_DEPENDENCIES_';

  /** Folders and files of other processes beside the descriptor that are older than this are deleted (`removeStale`). */
  static inline final STALE_SECONDS = 3600.0;

  /** The folder of this request's dump, or `null` when no list is read. */
  static var folder: Null<String> = null;

  /** True when Genes chose `folder` and may delete its files after reading them. */
  static var owned = false;

  /** The file that keeps `macroFiles` for this process, or `null` (`prepare`). */
  static var factsFile: Null<String> = null;

  /**
   * The folder where Haxe writes the macro context's list: the `dump-path`
   * of the command line, else `dump` in the working folder. Haxe copies
   * the defines into its macro context before any init macro runs
   * (`Common.clone`), so the `dump-path` that `prepare` sets reaches only
   * the program's list.
   */
  static var macroFolder: Null<String> = null;

  /** The full paths of the classes and enums of each module of this request (`noteModules`). */
  static var typeNames: Map<String, Array<String>> = new Map();

  /** The result of `edges` in this request, once read. */
  static var read: Null<HaxeDependencyEdges> = null;

  /** Time spent reading and parsing Haxe's lists in this request, in seconds. */
  public static var seconds(default, null) = 0.0;

  /**
   * Whether each module has a macro function, by module, with the epochs
   * that it was read for (`GenerationChangeSet.epochs`), so a module that
   * Haxe did not type again is not walked again.
   */
  @:persistent static var noted: Map<String,
    {epochs: String, macroFunction: Bool}> = new Map();

  /**
   * For each module, the digest of its epochs when Haxe typed it in a
   * request with the lists, and its lines that were modules of Haxe's macro
   * context in that request. `null` until `loadFacts` read the file of this
   * process (a new macro state of Genes starts without it).
   */
  @:persistent static var macroFiles: Null<Map<String,
    {epochs: String, files: Array<String>}>> = null;

  /** `fullPath` of each file that Haxe positions name, kept between requests. */
  @:persistent static var fullPaths: Map<String, String> = new Map();

  /** The modules of this request with their files (`noteModules`). */
  static var files: Map<String, String> = new Map();

  /** Whether each module of this request has a macro function (`noteModules`). */
  static var macroFunctions: Map<String, Bool> = new Map();

  /**
   * Makes Haxe write its dependency lists for this request when `wanted`
   * (a `-dce std` full request with module records, or a `-dce std` module
   * request), and deletes the lists of an earlier request.
   * `ModuleRequest.begin` calls it in every request with the incremental
   * define, before Genes reads the defines (`ModuleRequest.definesKey`).
   *
   * The folder is `<descriptor>.haxe-dependencies/<name>`, beside the
   * descriptor and never in the output tree. `dump-path` is part of
   * Haxe's compilation signature, so it is set in every request with the
   * define, also when no list is wanted, and `<name>` is kept in the process
   * environment: it stays the same for the life of one Haxe process, so
   * every request of a session shares one module cache, and another process
   * with the same descriptor (a cold build) writes into its own folder. The
   * first request of a process deletes the folders and files of other
   * processes that did not change for an hour (`removeStale`).
   *
   * When the session sets `dump-path` or `dump-dependencies` itself, Genes
   * changes neither of them, only adds `dump-dependencies` when it wants
   * the lists, and never deletes the files.
   */
  public static function prepare(descriptorPath: String, wanted: Bool): Void {
    read = null;
    seconds = 0.0;
    files = new Map();
    macroFunctions = new Map();
    typeNames = new Map();
    folder = null;
    owned = false;
    factsFile = null;
    macroFolder = null;
    if (Context.defined('dump-path') || Context.defined('dump-dependencies')) {
      if (!wanted)
        return;
      if (!Context.defined('dump-dependencies'))
        Compiler.define('dump-dependencies');
      folder = Context.definedValue('dump-path') ?? 'dump';
      macroFolder = folder;
      return;
    }
    macroFolder = 'dump';
    final parent = '$descriptorPath.haxe-dependencies';
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
      removeStale(parent);
    }
    final chosen = '$parent/$name';
    Compiler.define('dump-path', chosen);
    folder = chosen;
    owned = true;
    factsFile = '$chosen.macro-files';
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
   * Notes the modules of this request with their files, and whether each
   * one has a macro function. `grouped` holds every declaration by module,
   * before dead-code elimination (which can remove a macro function);
   * `moduleFiles` holds each module's file. `ModuleRequest.afterSaveSteps`
   * calls it.
   */
  public static function noteModules(grouped: Map<String, Array<Type>>,
      moduleFiles: Map<String, String>): Void {
    files = moduleFiles;
    macroFunctions = new Map();
    typeNames = new Map();
    for (module => types in grouped) {
      final names = [];
      for (type in types)
        switch type {
          case TInst(reference, _):
            final cls = reference.get();
            names.push(cls.pack.concat([cls.name]).join('.'));
          case TEnum(reference, _):
            final enm = reference.get();
            names.push(enm.pack.concat([enm.name]).join('.'));
          default:
        }
      typeNames.set(module, names);
      final epochs = GenerationChangeSet.epochs(module);
      final known = noted.get(module);
      final has = if (known != null && epochs.length > 0
        && known.epochs == epochs) known.macroFunction else {
        final found = hasMacroField(types);
        if (epochs.length > 0)
          noted.set(module, {epochs: epochs, macroFunction: found});
        found;
      }
      macroFunctions.set(module, has);
    }
  }

  /**
   * Returns true when a class of `types` (also an abstract's implementation)
   * has a macro function, such as `public static macro function twice(...)`.
   */
  static function hasMacroField(types: Array<Type>): Bool {
    function inClass(cls: ClassType): Bool {
      for (field in cls.statics.get().concat(cls.fields.get()))
        if (field.kind.match(FMethod(MethMacro)))
          return true;
      return false;
    }
    for (type in types)
      switch type {
        case TInst(reference, _):
          if (inClass(reference.get()))
            return true;
        case TAbstract(reference, _):
          final impl = reference.get().impl;
          if (impl != null && inClass(impl.get()))
            return true;
        default:
      }
    return false;
  }

  /**
   * Returns Haxe's dependencies of this request that count (see the class
   * comment), by module, each list sorted, and, by module, the listed
   * modules with a macro function (`HaxeDependencyEdges`). `only` limits
   * both to one module: a module request needs only the requested module,
   * and Genes then reads only that module's entry of the program's list.
   * Empty when Haxe wrote no list (the request did not generate, or the file
   * cannot be read). Reads the files once per request, in the generator,
   * after Haxe wrote them, and deletes Genes' own files.
   *
   * Example: `edges.get("genes.ts.Json")` holds `"genes.ts.JsonCodec"`.
   */
  public static function edges(only: Null<String>): HaxeDependencyEdges {
    final known = read;
    if (known != null)
      return known;
    final started = haxe.Timer.stamp();
    final result: HaxeDependencyEdges = {
      edges: new Map(),
      macroModules: new Map()
    };
    read = result;
    final base = folder;
    if (base != null) {
      final main = readText(Path.join([base, 'js', 'dependencies.dump']));
      final macroBase = macroFolder ?? base;
      final macroList = readText(Path.join([macroBase, 'macro', 'dependencies.dump']));
      if (owned)
        removeFiles();
      if (main != null)
        collect(result, main, macroList, only);
    }
    seconds += haxe.Timer.stamp() - started;
    return result;
  }

  /** Returns the text of `file`, or `null` when it cannot be read. */
  static function readText(file: String): Null<String> {
    return try File.getContent(file) catch (_:haxe.Exception) null;
  }

  /**
   * Fills `result` from the program's list `main` and the macro context's
   * list `macroList` (`null` when Haxe wrote none), for `only` or for every
   * module (see `edges`).
   */
  static function collect(result: HaxeDependencyEdges, main: String,
      macroList: Null<String>, only: Null<String>): Void {
    // The module of each file: exactly one module of the program, outside
    // the standard library, whose path the file ends with. A module of
    // Haxe's standard library is left out: Haxe adds some of them to
    // whichever class it is typing at the time (`haxe.Exception` in
    // `exceptions.ml`), so such a line depends on the order of a request,
    // and dead-code elimination, not loading, decides whether such a module
    // has a file.
    final byFile = new Map<String, String>();
    final shared = new Map<String, Bool>();
    for (module => source in files) {
      final full = fullPath(source);
      if (DceStdUses.isStdPath(full)
        || !StringTools.endsWith(full,
          '/' + module.split('.').join('/') + '.hx'))
        continue;
      if (byFile.exists(full))
        shared.set(full, true);
      byFile.set(full, module);
    }
    for (full in shared.keys())
      byFile.remove(full);
    // The files that were modules of Haxe's macro context in this request.
    final macroKeys: Null<Map<String,
      Bool>> = macroList == null ? null : entriesOf(macroList.split('\n'));
    // A module of the macro context: a file of the macro context's list (a
    // shared folder when Genes chose the program's folder, so it can hold
    // another process's list, which only adds files), or a module of the
    // program whose class or enum the macro interpreter knows. Haxe adds
    // the types of each module that it loads in the macro context to the
    // interpreter (`flush_macro_context`), and the interpreter keeps them
    // while it lives, so a module that the macro context loaded in this
    // request is always found.
    final loadedInMacro = new Map<String, Bool>();
    function macroModule(file: String): Bool {
      if (macroKeys != null && macroKeys.exists(file))
        return true;
      final module = byFile.get(file);
      if (module == null)
        return true;
      final known = loadedInMacro.get(module);
      if (known != null)
        return known;
      var found = false;
      for (name in typeNames.get(module) ?? [])
        if (Type.resolveClass(name) != null || Type.resolveEnum(name) != null)
          found = true;
      loadedInMacro.set(module, found);
      return found;
    }
    final retyped = new Map<String, Bool>();
    for (module in GenerationChangeSet.retypedModules())
      retyped.set(module, true);
    var factsChanged = loadFacts();
    final facts = macroFiles;
    // How often each file is an entry of the program's list: once for a
    // program module, more when a module that `registerModuleDependency`
    // or a macro-defined type made has the same file.
    var entryCounts: Null<Map<String, Int>> = null;
    function entryCount(file: String): Int {
      final counts = entryCounts;
      if (counts != null)
        return counts.get(file) ?? 0;
      var count = StringTools.startsWith(main, '$file:\n') ? 1 : 0;
      var at = main.indexOf('\n$file:\n');
      while (at >= 0) {
        count++;
        at = main.indexOf('\n$file:\n', at + 1);
      }
      return count;
    }
    function block(module: String, lines: Array<String>): Void {
      final counts = new Map<String, Int>();
      for (line in lines)
        if (byFile.exists(line))
          counts.set(line, (counts.get(line) ?? 0) + 1);
      // The lines that were modules of the macro context in the request
      // that typed `module`: this request when Haxe typed it now, else the
      // kept fact for its epochs, else unknown (`null`).
      final epochs = Context.signature(GenerationChangeSet.epochs(module));
      var suspects: Null<Map<String, Bool>> = null;
      if (retyped.exists(module)) {
        final found = [for (line in counts.keys()) if (macroModule(line)) line];
        found.sort(compareStrings);
        suspects = [for (line in found) line => true];
        if (facts != null) {
          facts.set(module, {epochs: epochs, files: found});
          factsChanged = true;
        }
      } else if (facts != null) {
        final kept = facts.get(module);
        if (kept != null && kept.epochs == epochs)
          suspects = [for (line in kept.files) line => true];
      }
      final found = [];
      final macros = [];
      for (line => count in counts) {
        final dependency = byFile.get(line);
        if (dependency == null || dependency == module || entryCount(line) != 1)
          continue;
        if (macroFunctions.get(dependency) == true) {
          macros.push(dependency);
          if (count >= 2)
            found.push(dependency);
        } else if (suspects != null && !suspects.exists(line)) {
          found.push(dependency);
        }
      }
      found.sort(compareStrings);
      macros.sort(compareStrings);
      result.edges.set(module, found);
      result.macroModules.set(module, macros);
    }
    if (only != null) {
      // A module request: read only the requested module's entry.
      final source = files.get(only);
      final file = source == null ? null : fullPath(source);
      if (file != null && byFile.get(file) == only) {
        var start = -1;
        if (StringTools.startsWith(main, '$file:\n'))
          start = file.length + 2;
        else {
          final at = main.indexOf('\n$file:\n');
          if (at >= 0)
            start = at + file.length + 3;
        }
        if (start >= 0) {
          final lines = [];
          var at = start;
          while (at < main.length
            && StringTools.fastCodeAt(main, at) == '\t'.code) {
            var end = main.indexOf('\n', at);
            if (end < 0)
              end = main.length;
            lines.push(main.substring(at + 1, end));
            at = end + 1;
          }
          block(only, lines);
        }
      }
    } else {
      final all = main.split('\n');
      final counts = new Map<String, Int>();
      for (line in all)
        if (line.length > 1 && StringTools.fastCodeAt(line, 0) != '\t'.code
          && StringTools.endsWith(line, ':')) {
          final file = line.substr(0, line.length - 1);
          counts.set(file, (counts.get(file) ?? 0) + 1);
        }
      entryCounts = counts;
      var current: Null<String> = null;
      var lines = [];
      for (line in all) {
        if (line.length == 0)
          continue;
        if (StringTools.fastCodeAt(line, 0) == '\t'.code) {
          if (current != null)
            lines.push(line.substr(1));
          continue;
        }
        if (current != null)
          block(current, lines);
        lines = [];
        current = StringTools.endsWith(line,
          ':') ? byFile.get(line.substr(0, line.length - 1)) : null;
      }
      if (current != null)
        block(current, lines);
      // Forget the facts of modules that are no longer in the program.
      if (facts != null)
        for (module in [for (key in facts.keys()) key])
          if (!files.exists(module)) {
            facts.remove(module);
            factsChanged = true;
          }
    }
    if (factsChanged)
      storeFacts();
  }

  /** Returns the files that are entries (`<file>:` lines) of a dependency list. */
  static function entriesOf(lines: Array<String>): Map<String, Bool> {
    final result = new Map<String, Bool>();
    for (line in lines)
      if (line.length > 1 && StringTools.fastCodeAt(line, 0) != '\t'.code
        && StringTools.endsWith(line, ':'))
        result.set(line.substr(0, line.length - 1), true);
    return result;
  }

  /**
   * Reads `macroFiles` from this process's file when this macro state of
   * Genes has none yet. Returns true when Genes keeps a file and could not
   * read it, so that the next write makes it again.
   */
  static function loadFacts(): Bool {
    if (macroFiles != null)
      return false;
    final loaded = new Map<String, {epochs: String, files: Array<String>}>();
    macroFiles = loaded;
    final file = factsFile;
    final text = file == null ? null : readText(file);
    if (text == null)
      return file != null;
    for (line in text.split('\n')) {
      final parts = line.split('\t');
      if (parts.length >= 2)
        loaded.set(parts[0], {epochs: parts[1], files: parts.slice(2)});
    }
    return false;
  }

  /**
   * Writes `macroFiles` to this process's file: a new file, then a rename,
   * so a reader never sees part of it. When it cannot be written, the older
   * file is deleted, so a new macro state never reads facts that are no
   * longer true (it then counts no line that needs them).
   */
  static function storeFacts(): Void {
    final file = factsFile;
    final facts = macroFiles;
    if (file == null || facts == null)
      return;
    final keys = [for (key in facts.keys()) key];
    keys.sort(compareStrings);
    final buffer = new StringBuf();
    for (module in keys) {
      final entry = facts.get(module);
      if (entry != null)
        buffer.add([module, entry.epochs].concat(entry.files).join('\t')
          + '\n');
    }
    final temporary = '$file.tmp';
    try {
      FileSystem.createDirectory(Path.directory(file));
      File.saveContent(temporary, buffer.toString());
      FileSystem.rename(temporary, file);
    } catch (_:haxe.Exception) {
      try {
        if (FileSystem.exists(file))
          FileSystem.deleteFile(file);
      } catch (_:haxe.Exception) {}
    }
  }

  /**
   * Returns true when `module` has a macro function (see `noteModules`).
   * `ModuleRequest` asks it for a dependency that only Haxe's list names,
   * to know whether that module is a project macro module.
   */
  public static function hasMacroFunction(module: String): Bool {
    return macroFunctions.get(module) == true;
  }

  /**
   * Returns `file` as Haxe 4.3.7 writes it in the list (`Path.get_full_path`
   * on Unix): absolute, with `.` and `..` resolved, symbolic links kept.
   * Kept between requests by the text of `file`: the working folder is
   * part of the session key, so the same text names the same path.
   */
  static function fullPath(file: String): String {
    final known = fullPaths.get(file);
    if (known != null)
      return known;
    final full = PathUtil.normalize(FileSystem.absolutePath(file));
    fullPaths.set(file, full);
    return full;
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
    removeDump(base);
    // Haxe writes the macro context's list into `dump` in the working
    // folder (`macroFolder`); delete those two files, and the folders only
    // when they are empty.
    final shared = macroFolder;
    if (shared != null)
      removeDump(shared, ['macro']);
  }

  /**
   * Deletes the two files that Haxe writes into each folder of `targets`
   * below `base`, then each folder and `base`, each only when it is empty.
   */
  static function removeDump(base: String, ?targets: Array<String>): Void {
    for (target in targets ?? ['js', 'macro']) {
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
    try {
      if (FileSystem.exists(base))
        FileSystem.deleteDirectory(base);
    } catch (_:haxe.Exception) {}
  }

  /**
   * Deletes, in `parent`, the dump folders and fact files of other
   * processes that did not change for an hour: a process that stopped
   * between Haxe's write and Genes' read leaves its dump folder, and every
   * process leaves its fact file. A live process makes its dump folder again
   * in each request; if its fact file is deleted, a new macro state of it
   * counts fewer lines, which can only refuse a preview.
   */
  static function removeStale(parent: String): Void {
    final names = try FileSystem.readDirectory(parent) catch (_:haxe.Exception)
      [];
    final now = Date.now().getTime();
    for (name in names) {
      final entry = Path.join([parent, name]);
      try {
        if (now - FileSystem.stat(entry).mtime.getTime() < STALE_SECONDS * 1000)
          continue;
        if (FileSystem.isDirectory(entry))
          removeDump(entry);
        else
          FileSystem.deleteFile(entry);
      } catch (_:haxe.Exception) {}
    }
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}

/** The result of `HaxeDependencies.edges`. */
typedef HaxeDependencyEdges = {
  /** The dependencies that count, by dependent module, each list sorted. */
  final edges: Map<String, Array<String>>;

  /**
   * The listed modules with a macro function, by dependent module, also
   * those listed once (an instance macro, a macro through `@:using`), which
   * are no edge. `ModuleRequest` treats a project macro module among them
   * as opaque.
   */
  final macroModules: Map<String, Array<String>>;
}
#end
