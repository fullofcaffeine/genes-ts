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
 * (`generate.ml`): `<dump-path>/js/dependencies.dump` for the program and
 * `<dump-path>/macro/dependencies.dump` for Haxe's macro context. Haxe
 * copies the defines into its macro context before any init macro runs
 * (`Common.clone`), so the macro list goes to the `dump-path` of the command
 * line. The Genes development session gives one
 * (`<request folder>/haxe-dependencies`, `bindHaxeInvocation`), so both
 * lists go to that folder and Genes deletes nothing there. Without it (a
 * hand-run request), Genes sets its own `dump-path` for the program's list,
 * and the macro list goes to `dump/macro` of the working folder; Genes then
 * deletes those two files after it reads them and leaves the folders. Only
 * `dump-path` is part of the compilation signature, and it stays the same
 * for every request of one process, so the module cache stays shared.
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
 *   the file of `A` must be an entry exactly once too: when it is an entry
 *   more than once, a block of it can be another module's (a type that a
 *   macro defined with that file), and no block of it counts, whatever the
 *   order of the list (`collect`);
 * - and either `X` has a macro function and `F` is listed at least twice
 *   for `A` (a macro module and `X` itself: a macro call also resolves the
 *   class of `X` in the program), or `X` has no macro function, has a
 *   class or enum in the program, and `F` was not a module of Haxe's macro
 *   context when Haxe typed `A` (the macro fact below).
 *
 * The macro fact. Haxe loads each macro module of `A` while it types `A`,
 * and adds its types to the macro interpreter (`flush_macro_context`),
 * which keeps them while it lives. So for a module that Haxe typed in this
 * request, `F` is a macro module when `F` is an entry of this request's
 * macro list, or when a class or enum of `X` is known to the interpreter
 * (`Type.resolveClass`). The interpreter cannot see a module whose program
 * part has no class or enum (only typedefs, with a macro-only class), so a
 * line listed once never counts for such a module; an inline call or an
 * inline constant always has a class behind it. When the macro list cannot be read, the fact is
 * unknown. Genes keeps the fact of each module by the digest of its epochs
 * (`GenerationChangeSet.epochs`), also in a file beside the descriptor that
 * outlives a new macro state of Genes, because a later request reuses the
 * module from Haxe's cache without loading its macro modules again. An
 * unknown fact counts no line listed once.
 *
 * The assumption: a module that arrives without a Genes stamp
 * (`GenerationChangeSet.retypedModules`) was typed in this request, so its
 * lines are judged against this request's interpreter and macro list. It
 * can be wrong: a request that Genes does not stamp (an editor request
 * with the session's defines, which shares the module cache because Haxe
 * leaves `display` out of the signature) can type a module, and a module
 * that a macro types after the after-typing step is saved without a stamp
 * too. Such a module arrives unstamped in each later request. Its macro
 * modules were loaded into the interpreter of that earlier request, and an
 * interpreter keeps them, so the judgement holds while the interpreter is
 * the same. Genes marks each macro state with a name, keeps the first name
 * of the process in the process environment, and trusts the assumption
 * only while every request of the process ran in that macro state. After a
 * new macro state (a macro error, a changed macro module), the fact of a
 * module that arrives unstamped is unknown for the rest of the process;
 * kept facts of modules that keep their stamps still count. Example: an
 * editor request types `mr.reach.Built`, whose build macro loads
 * `mr.reach.Model` in the macro context; a macro error starts a new
 * interpreter; the next full request reuses `mr.reach.Built` unstamped, and
 * its line `mr/reach/Model.hx` does not count.
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
 * Limits: a module whose file also holds a `genes.ts.Imports` holder or any
 * other macro-defined type (a `Context.defineType` of a project macro or a
 * library, also one with an explicit `moduleDependency` that names the
 * module) carries no edge from Haxe's list, so a module that only it
 * reaches makes previews refuse more often until genes-f8vc.14.41 (record
 * the module that made each holder). A session `dump-path` folder that two Haxe processes share at the
 * same time can give one of them the other's lists (the development session
 * runs one server for its folder). On Windows, `scan` reads Haxe's text-mode
 * lists (`\r\n`, `\`), but a file whose full path Haxe spells otherwise
 * than `fullPath` (for example the drive letter's case) gives no edge; this
 * was checked only with `HaxeDependenciesProbe`, not on Windows. Haxe also writes `dependants.dump` for
 * both contexts, which Genes does not read; Haxe 4.3.7 has no define that
 * leaves it out. A hand-run request without a session `dump-path` reads the
 * shared `dump/macro` list of the working folder, which can hold another
 * process's list; that only adds suspects.
 */
class HaxeDependencies {
  /** The start of the environment variables of this class (`prepare`). */
  static inline final VARIABLE_PREFIX = 'GENES_HAXE_DEPENDENCIES_';

  /** True on Windows, where Haxe writes the lists with `\r\n` and `\` (`scan`). */
  static final WINDOWS = Sys.systemName() == 'Windows';

  /** Folders and files of other processes beside the descriptor that are older than this are deleted (`removeStale`). */
  static inline final STALE_SECONDS = 3600.0;

  /** The folder of this request's program list, or `null` when no list is read. */
  static var folder: Null<String> = null;

  /** True when Genes chose `folder` and deletes its files after reading them. */
  static var owned = false;

  /** The folder of the macro context's list (see the class comment), or `null`. */
  static var macroFolder: Null<String> = null;

  /** True when the macro list is the shared `dump/macro` of the working folder, whose two files Genes deletes. */
  static var macroShared = false;

  /** The file that keeps `macroFiles` for this process, or `null` (`prepare`). */
  static var factsFile: Null<String> = null;

  /** True when every request of this process ran in this macro state (the assumption of the class comment). */
  static var sameMacroState = false;

  /** The full paths of the classes and enums of each module of this request (`noteModules`). */
  static var typeNames: Map<String, Array<String>> = new Map();

  /** The result of `edges` in this request, once read. */
  static var read: Null<HaxeDependencyEdges> = null;

  /** Time spent reading and parsing Haxe's lists in this request, in seconds. */
  public static var seconds(default, null) = 0.0;

  /**
   * The modules typed again with an unknown macro fact: modules of this
   * request with an entry in Haxe's list that Haxe typed again, while the
   * process had already run in another macro state (the limit of the class
   * comment). A line listed once does not count for them; a module that
   * lists no such line counts too. Both reports give it
   * (`newMacroStateModules`), so a measurement shows whether that limit
   * happens.
   */
  public static var newMacroStateModules(default, null) = 0;

  /** A name for this macro state of Genes, made on first use (`prepare`). */
  @:persistent static var macroState: Null<String> = null;

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
   * context then. `null` until `loadFacts` read the file of this process (a
   * new macro state of Genes starts without it).
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
   * request), and deletes Genes' own lists of an earlier request.
   * `ModuleRequest.begin` calls it in every request with the incremental
   * define, before Genes reads the defines (`ModuleRequest.definesKey`).
   *
   * With a session `dump-path` (or `dump-dependencies`), Genes changes
   * neither define, only adds `dump-dependencies` when it wants the lists,
   * and never deletes the files. Without one, Genes sets `dump-path` to
   * `<descriptor>.haxe-dependencies/<name>`, beside the descriptor and never
   * in the output tree. `dump-path` is part of Haxe's compilation
   * signature, so Genes sets it in every request with the define, also when
   * no list is wanted, and the process environment keeps `<name>` for the
   * life of one Haxe process: every request of a session shares one module
   * cache, and another process with the same descriptor (a cold build)
   * writes into its own folder. The first request of a process deletes the
   * folders and files of other processes there that did not change for an
   * hour (`removeStale`). `<name>.macro-files` keeps the macro facts in both
   * cases.
   */
  public static function prepare(descriptorPath: String, wanted: Bool): Void {
    read = null;
    seconds = 0.0;
    newMacroStateModules = 0;
    files = new Map();
    macroFunctions = new Map();
    typeNames = new Map();
    folder = null;
    owned = false;
    macroFolder = null;
    macroShared = false;
    final parent = '$descriptorPath.haxe-dependencies';
    final key = haxe.crypto.Sha1.encode(descriptorPath).substr(0, 16);
    final nameVariable = VARIABLE_PREFIX + key;
    var name = Sys.getEnv(nameVariable);
    if (name == null || name.length == 0) {
      name = randomName();
      Sys.putEnv(nameVariable, name);
      removeStale(parent);
    }
    factsFile = '$parent/$name.macro-files';
    // The first macro state of the process, or `*` once another one ran.
    var state = macroState;
    if (state == null) {
      state = randomName();
      macroState = state;
    }
    final stateVariable = VARIABLE_PREFIX + 'STATE_' + key;
    final first = Sys.getEnv(stateVariable);
    if (first == null || first.length == 0)
      Sys.putEnv(stateVariable, state);
    else if (first != state && first != '*')
      Sys.putEnv(stateVariable, '*');
    sameMacroState = Sys.getEnv(stateVariable) == state;
    if (Context.defined('dump-path') || Context.defined('dump-dependencies')) {
      if (!wanted)
        return;
      if (!Context.defined('dump-dependencies'))
        Compiler.define('dump-dependencies');
      folder = Context.definedValue('dump-path') ?? 'dump';
      macroFolder = folder;
      return;
    }
    final chosen = '$parent/$name';
    Compiler.define('dump-path', chosen);
    folder = chosen;
    owned = true;
    macroFolder = 'dump';
    macroShared = true;
    removeFiles();
    if (!wanted) {
      folder = null;
      macroFolder = null;
      return;
    }
    Compiler.define('dump-dependencies');
    // Haxe 4.3.7 makes only the folders below `dump-path`, not the folders
    // that the path itself names.
    try
      FileSystem.createDirectory(chosen)
    catch (_:haxe.Exception) {}
  }

  /** Returns a new random name of 16 hexadecimal digits. */
  static function randomName(): String {
    return haxe.crypto.Sha1.encode(Std.string(Sys.time())
      + ':'
      + Std.string(Std.random(0x3FFFFFFF))
      + ':'
      + Std.string(Std.random(0x3FFFFFFF)))
      .substr(0, 16);
  }

  /**
   * Notes the modules of this request with their files, the full paths of
   * their classes and enums, and whether each one has a macro function.
   * `grouped` holds every declaration by module, before dead-code
   * elimination (which can remove a macro function); `moduleFiles` holds
   * each module's file. `ModuleRequest.afterSaveSteps` calls it.
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
   * after Haxe wrote them, and deletes the files that Genes owns.
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
    final macroBase = macroFolder;
    if (base != null && macroBase != null) {
      final main = readText(Path.join([base, 'js', 'dependencies.dump']));
      final macroList = readText(Path.join([macroBase, 'macro', 'dependencies.dump']));
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
   * One pass over a dependency list: how often each file is an entry (a
   * line `<file>:`), and, when `wanted` is not `null`, the lines of the
   * entries whose file is in `wanted`. It allocates one string per entry
   * line and per kept line, and none for the other lines.
   *
   * `windows`: Haxe writes the list in text mode, so on Windows each line
   * ends with `\r\n` and a path uses `\`. The `\r` is dropped on every
   * system, and on Windows each `\` becomes `/`, the separator of
   * `fullPath`. Example: `C:\app\src\mr\A.hx:\r\n` gives the entry
   * `C:/app/src/mr/A.hx`. A file that still differs from `fullPath` (for
   * example a drive letter in another case) gives no edge, which can only
   * refuse a preview. `HaxeDependenciesProbe` checks both forms.
   */
  public static function scan(text: String, wanted: Null<Map<String, Bool>>,
      windows: Bool): {
    entries: Map<String, Int>,
    blocks: Array<{file: String, lines: Array<String>}>
  } {
    function clean(path: String): String {
      return windows
        && path.indexOf('\\') >= 0 ? path.split('\\').join('/') : path;
    }
    final entries = new Map<String, Int>();
    final blocks = [];
    var lines: Null<Array<String>> = null;
    var at = 0;
    final length = text.length;
    while (at < length) {
      final next = text.indexOf('\n', at);
      final stop = next < 0 ? length : next;
      var end = stop;
      if (end > at && StringTools.fastCodeAt(text, end - 1) == '\r'.code)
        end--;
      if (end > at) {
        if (StringTools.fastCodeAt(text, at) == '\t'.code) {
          if (lines != null)
            lines.push(clean(text.substring(at + 1, end)));
        } else if (StringTools.fastCodeAt(text, end - 1) == ':'.code) {
          final file = clean(text.substring(at, end - 1));
          entries.set(file, (entries.get(file) ?? 0) + 1);
          lines = null;
          if (wanted == null || wanted.exists(file)) {
            final kept = [];
            blocks.push({file: file, lines: kept});
            lines = kept;
          }
        } else {
          lines = null;
        }
      }
      at = stop + 1;
    }
    return {entries: entries, blocks: blocks};
  }

  /**
   * Fills `result` from the program's list `main` and the macro context's
   * list `macroList` (`null` when it cannot be read), for `only` or for
   * every module (see `edges`).
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
    // The files that were modules of Haxe's macro context in this request,
    // or `null` when the macro list cannot be read (then no fact of this
    // request is known).
    final macroKeys = macroList == null ? null : scan(macroList, new Map(),
      WINDOWS).entries;
    final loadedInMacro = new Map<String, Bool>();
    function macroModule(keys: Map<String, Int>, file: String): Bool {
      if (keys.exists(file))
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
    var wanted: Null<Map<String, Bool>> = null;
    if (only != null) {
      final source = files.get(only);
      final file = source == null ? null : fullPath(source);
      wanted = new Map();
      if (file != null && byFile.get(file) == only)
        wanted.set(file, true);
    }
    final scanned = scan(main, wanted, WINDOWS);
    final entries = scanned.entries;
    for (block in scanned.blocks) {
      // A file that is an entry more than once also names other modules: a
      // type that a macro defined with that file (`Context.defineType` takes
      // the file of the module being typed, or of the module that its
      // `moduleDependency` names; for example a holder of `genes.ts.Imports`
      // or a type that a project macro defines), or a module that
      // `registerModuleDependency` made (`$DEP`). A block of that file can
      // be another module's, and Genes cannot yet tell whose, so no block of
      // it counts, whatever the order of the list (`sort_types`). A merge of
      // `genes.ts.Imports` holders gave stale previews (review of #274:
      // `probe7-explicit-module-dependency`,
      // `probe8-displaced-holder-and-module-dependency`); genes-f8vc.14.41
      // records the module that made each holder.
      final module = byFile.get(block.file);
      if (module == null || (entries.get(block.file) ?? 0) != 1)
        continue;
      final counts = new Map<String, Int>();
      for (line in block.lines)
        if (byFile.exists(line))
          counts.set(line, (counts.get(line) ?? 0) + 1);
      // The macro fact of `module` (see the class comment): this request's
      // when Haxe typed it now, the macro list was read and every request of
      // the process ran in this macro state; else the kept fact for its
      // epochs; else unknown (`null`).
      final epochs = Context.signature(GenerationChangeSet.epochs(module));
      var suspects: Null<Map<String, Bool>> = null;
      if (retyped.exists(module)) {
        if (macroKeys != null && sameMacroState) {
          final found = [
            for (line in counts.keys())
              if (macroModule(macroKeys, line)) line
          ];
          found.sort(compareStrings);
          suspects = [for (line in found) line => true];
          if (facts != null) {
            facts.set(module, {epochs: epochs, files: found});
            factsChanged = true;
          }
        } else {
          if (macroKeys != null && !sameMacroState)
            newMacroStateModules++;
          if (facts != null && facts.exists(module)) {
            facts.remove(module);
            factsChanged = true;
          }
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
        if (dependency == null || dependency == module
          || (entries.get(line) ?? 0) != 1)
          continue;
        if (macroFunctions.get(dependency) == true) {
          macros.push(dependency);
          if (count >= 2)
            found.push(dependency);
        } else if (suspects != null && !suspects.exists(line)
          && (typeNames.get(dependency) ?? []).length > 0) {
          // A module without a class or enum in the program is never
          // counted on a line listed once: the interpreter test cannot see
          // its macro-only classes, and an inline call or an inline constant
          // always has a class behind it.
          found.push(dependency);
        }
      }
      found.sort(compareStrings);
      macros.sort(compareStrings);
      result.edges.set(module, found);
      result.macroModules.set(module, macros);
    }
    // Forget the facts of modules that are no longer in the program.
    if (only == null && facts != null)
      for (module in [for (key in facts.keys()) key])
        if (!files.exists(module)) {
          facts.remove(module);
          factsChanged = true;
        }
    if (factsChanged)
      storeFacts();
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
   * Deletes the files that Genes owns: its own dump folder of the program's
   * list (the files and the folders), and, without a session `dump-path`,
   * the two files of the shared `dump/macro` of the working folder, whose
   * folders stay, so another process that writes there at the same time
   * never loses a folder. An old list is never read and no large file stays.
   */
  static function removeFiles(): Void {
    final base = folder;
    if (base != null && owned)
      removeDump(base);
    final shared = macroFolder;
    if (shared != null && macroShared)
      for (name in ['dependencies.dump', 'dependants.dump']) {
        final file = Path.join([shared, 'macro', name]);
        try {
          if (FileSystem.exists(file))
            FileSystem.deleteFile(file);
        } catch (_:haxe.Exception) {}
      }
  }

  /**
   * Deletes the two files that Haxe writes into each of the folders `js` and
   * `macro` of Genes' own dump folder `base`, then those folders and `base`,
   * each only when it is empty.
   */
  static function removeDump(base: String): Void {
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
