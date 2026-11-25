package genes.incremental;

#if macro
import haxe.macro.Context;
import haxe.macro.Expr;
import sys.FileSystem;

/**
 * One `--macro include(...)` line of a full request, with the arguments
 * that Genes read from its text and the modules that it adds to the
 * program.
 *
 * Example: `include('app.domain', false)` with the class paths `src` and
 * `lib` gives `pack: "app.domain"`, `recursive: false`, `ignore: null`,
 * `classPaths: ["src", "lib"]`, and `modules` such as
 * `["app.domain.Note", "app.domain.Store"]`.
 */
typedef IncludeRoot = {
  /** The text after `--macro`, as the request gave it. */
  final text: String;

  final pack: String;
  final recursive: Bool;

  /** The `ignore` argument; `null` when the line gives none. */
  final ignore: Null<Array<String>>;

  /**
   * The class paths that `include` searched: its `classPaths` argument, or
   * the class paths of the request, normalized as `include` normalizes
   * them. A module request lists the same folders again.
   */
  final classPaths: Array<String>;

  /** The modules that `include` adds (`Context.getModule`), sorted. */
  final modules: Array<String>;
}

/**
 * The roots of a full request beside `--main` (genes-f8vc.14.12): what a
 * module request needs to know about them.
 */
typedef ProgramRootsFacts = {
  /** The class-name arguments (`app.Tool` in `haxe ... app.Tool`), in order. */
  final classNames: Array<String>;

  /** Every `include` line that Genes could read. */
  final includes: Array<IncludeRoot>;

  /**
   * Why Genes cannot know every module that an `include` line adds, one
   * text per line; empty when it knows them. Example: an argument that is
   * not a literal, such as `include(Packages.ui)`.
   */
  final unknown: Array<String>;
}

/**
 * Reads the roots of a full request that are not its `--main` class, and
 * checks in a later module request that the `include` lines still add the
 * same modules (genes-f8vc.14.12).
 *
 * Why: a module request has no `--main` and no other root of the program;
 * the session leaves them out, because they make Haxe type the modules that
 * import the edited one. Under `-dce std` a module request refuses when a
 * module with an output file may leave the program (`module-may-leave`,
 * `ModuleRequest.modulesThatMayLeave`). It used to count as staying only the
 * modules that the `--main` class reaches. A module that only a class-name
 * argument or an `include` line brings into the program was then never
 * reached, so every module request of such a program was refused. Example:
 * Caffeine's development build has `--main caffeine.ui.Main` and four
 * `include(pack, false)` lines.
 *
 * What: the full request stores the class-name arguments and, for each
 * `include` line, the modules that it adds. Haxe loads every one of these
 * modules in every full build with the same arguments and the same files,
 * so a module request counts them, and every module that they load, as
 * staying. An edit can change which modules an `include` line adds only by
 * changing the files in the included folders (a new or removed file), so a
 * module request lists the folders again and refuses when the list differs
 * (`include-changed`, `includeFailure`). A changed argument of the program
 * changes `programDigest`, which the session key holds, so such a request
 * is refused with `session-changed`.
 *
 * How it reads the arguments: `Compiler.getConfiguration().args`, with HXML
 * files and `-lib` arguments already expanded. A plain argument is a class
 * name when it is a dotted path and not the value of an option. Every
 * option outside `ZERO_VALUE_OPTIONS` counts as one that takes a value, so
 * a mistake can only miss a root: a missed root makes Genes refuse
 * (`module-may-leave`), never publish a wrong file.
 *
 * How it finds the modules of an `include` line: `includedModules` is a port
 * of the file listing of `haxe.macro.Compiler.include` in Haxe 4.3.7. Haxe
 * runs that listing after every init macro (`Context.onAfterInitMacros`),
 * so the place of the line before or after `genes.Generator.use()` does not
 * change it; Genes lists the folders again after the commit. A module of
 * that list that is not in the program (a file added between the two
 * listings) makes the facts unknown, and every module request is refused
 * until the next full request.
 *
 * What it does not claim: an init macro other than `include` that loads a
 * module by name is not read; such a module is not counted as staying, so
 * the request is refused under `-dce std` (`module-may-leave`). Arguments
 * after `--next` or `--each` are not read.
 */
class ProgramRoots {
  /**
   * The Haxe 4.3.7 options that take no value. Any other option counts as
   * one that takes a value, so the argument after it is never read as a
   * class name. `--run` and `--next`, `--each` stop the reading.
   */
  static final ZERO_VALUE_OPTIONS = [
    '--interp',
    '-v',
    '--verbose',
    '--debug',
    '-debug',
    '--version',
    '-version',
    '-h',
    '--help',
    '-help',
    '--help-defines',
    '--help-user-defines',
    '--help-metas',
    '--help-user-metas',
    '--flash-strict',
    '--prompt',
    '-prompt',
    '--no-traces',
    '--no-output',
    '--times',
    '--no-inline',
    '--no-opt',
    '--haxelib-global'
  ];

  static final STOP_OPTIONS = ['--run', '--next', '--each'];

  static final INCLUDE_CALL = 'haxe.macro.Compiler.include';

  /**
   * Reads the class-name arguments and the `include` lines of this request,
   * and lists the modules that each `include` line adds. `observed` names
   * every module of the program (`GenerationChangeSet.observedModules`):
   * a listed module outside it makes the facts unknown.
   *
   * Example: `--main app.Main app.Tool --macro include('app.views')` gives
   * the class name `app.Tool` and one include with the modules of
   * `app/views` and its subfolders.
   */
  public static function read(observed: Array<String>): ProgramRootsFacts {
    final configuration = haxe.macro.Compiler.getConfiguration();
    if (configuration == null)
      return {
        classNames: [],
        includes: [],
        unknown: ['the compiler arguments are not known']
      };
    final inProgram = new Map<String, Bool>();
    for (name in observed)
      inProgram.set(name, true);
    final args = configuration.args;
    final classNames = [];
    final includes = [];
    final unknown = [];
    var index = 0;
    while (index < args.length) {
      final arg = args[index];
      if (STOP_OPTIONS.indexOf(arg) >= 0) {
        unknown.push('the arguments after $arg are not read');
        break;
      }
      if (StringTools.startsWith(arg, '-')) {
        if (ZERO_VALUE_OPTIONS.indexOf(arg) >= 0) {
          index++;
          continue;
        }
        final value = index + 1 < args.length ? args[index + 1] : null;
        index += 2;
        if (arg == '--macro' && value != null) {
          final call = ModuleRequest.initMacroCall(value);
          if (call == INCLUDE_CALL) {
            final include = includeOf(value);
            if (include == null)
              unknown.push('Genes cannot read the arguments of `$value`');
            else {
              final missing = include.modules.filter(name ->
                !inProgram.exists(name));
              if (missing.length > 0)
                unknown.push('`$value` lists ${missing[0]}, which is not in the program');
              includes.push(include);
            }
          } else if (call == null && value.indexOf('include') >= 0)
            unknown.push('Genes cannot read the call of `$value`');
        }
        continue;
      }
      index++;
      if (isDottedPath(arg))
        classNames.push(arg);
    }
    return {classNames: classNames, includes: includes, unknown: unknown};
  }

  /**
   * Returns every module that the full request's roots beside `--main`
   * bring into the program: the class names and the modules of every
   * `include` line.
   */
  public static function modulesOf(facts: ProgramRootsFacts): Array<String> {
    final names = facts.classNames.copy();
    for (include in facts.includes)
      for (name in include.modules)
        names.push(name);
    return names;
  }

  /**
   * Returns why the `include` lines of the stored full request may add
   * other modules now, or `null` (`include-changed`). It lists each
   * included folder again with the stored arguments and compares the
   * modules. Example: a new file `app/domain/Tag.hx` under
   * `include('app.domain', false)` gives
   * "`include('app.domain', false)` now adds app.domain.Tag".
   */
  public static function includeFailure(facts: ProgramRootsFacts): Null<String> {
    if (facts.unknown.length > 0)
      return facts.unknown[0];
    for (include in facts.includes) {
      final now = includedModules(include.pack, include.recursive,
        include.ignore, include.classPaths);
      final before = new Map<String, Bool>();
      for (name in include.modules)
        before.set(name, true);
      final after = new Map<String, Bool>();
      for (name in now)
        after.set(name, true);
      for (name in now)
        if (!before.exists(name))
          return '`${include.text}` now adds $name';
      for (name in include.modules)
        if (!after.exists(name))
          return '`${include.text}` no longer adds $name';
    }
    return null;
  }

  /** One text per root, sorted by kind, for the records text (`ModuleRequest.recordsText`). */
  public static function text(facts: ProgramRootsFacts): String {
    final buffer = new StringBuf();
    for (name in facts.classNames)
      buffer.add('root class $name\n');
    for (include in facts.includes)
      buffer.add('root include ${include.text} ${include.modules.join(' ')}\n');
    for (reason in facts.unknown)
      buffer.add('root unknown $reason\n');
    return buffer.toString();
  }

  /**
   * Reads the arguments of the `include` call in `text` and lists its
   * modules, or returns `null` when an argument is not a literal that Genes
   * can read: a string, `true`, `false`, `null`, or an array of strings.
   */
  static function includeOf(text: String): Null<IncludeRoot> {
    final parsed = try Context.parse(text,
      Context.currentPos()) catch (_:haxe.Exception) null;
    final params = parsed == null ? null : switch parsed.expr {
      case ECall(_, params): params;
      default: null;
    }
    if (params == null || params.length == 0 || params.length > 5)
      return null;
    final pack = stringOf(params[0]);
    if (pack == null)
      return null;
    final recursive = params.length > 1 ? boolOf(params[1]) : Absent;
    final ignore = params.length > 2 ? stringsOf(params[2]) : Absent;
    final paths = params.length > 3 ? stringsOf(params[3]) : Absent;
    final strict = params.length > 4 ? boolOf(params[4]) : Absent;
    final recursiveValue = switch recursive {
      case Absent | IsNull: true;
      case Given(value): value;
      case Unreadable: return null;
    };
    final ignoreValue = switch ignore {
      case Absent | IsNull: null;
      case Given(value): value;
      case Unreadable: return null;
    };
    final classPaths = switch paths {
      case Absent | IsNull: normalizedClassPaths();
      case Given(value): value;
      case Unreadable: return null;
    };
    switch strict {
      case Unreadable:
        return null;
      default:
    }
    // `include` adds nothing in a display request other than `usage`.
    final display = Context.definedValue('display');
    final modules = switch paths {
      case Absent | IsNull if (display != null && display != 'usage'): [];
      default: includedModules(pack, recursiveValue, ignoreValue, classPaths);
    };
    modules.sort(compareStrings);
    return {
      text: text,
      pack: pack,
      recursive: recursiveValue,
      ignore: ignoreValue,
      classPaths: classPaths,
      modules: modules
    };
  }

  /**
   * The class paths of the request as `include` normalizes them: `\` becomes
   * `/`, a last `/` goes, and an empty path is `.`.
   */
  static function normalizedClassPaths(): Array<String> {
    return [
      for (path in Context.getClassPath()) {
        var cp = StringTools.replace(path, '\\', '/');
        if (StringTools.endsWith(cp, '/')) cp = cp.substr(0, cp.length - 1);
        cp == '' ? '.' : cp;
      }
    ];
  }

  /**
   * Returns the modules that `haxe.macro.Compiler.include(pack, recursive,
   * ignore, classPaths)` loads with `Context.getModule`, in the order of
   * the listing: a port of its file walk in Haxe 4.3.7. Each `.hx` file
   * whose name has no other dot, other than `import.hx`, is a module; with
   * `recursive`, each subfolder is included too. An `ignore` entry that
   * ends with `*` skips every module and folder whose path starts with the
   * rest; another entry skips that exact path.
   */
  public static function includedModules(pack: String, recursive: Bool,
      ignore: Null<Array<String>>, classPaths: Array<String>): Array<String> {
    final ignoreWildcard = [];
    final ignoreString = [];
    if (ignore != null)
      for (rule in ignore)
        if (StringTools.endsWith(rule, '*'))
          ignoreWildcard.push(rule.substr(0, rule.length - 1));
        else
          ignoreString.push(rule);
    function skip(name: String): Bool {
      if (ignore == null)
        return false;
      if (ignoreString.indexOf(name) >= 0)
        return true;
      for (rule in ignoreWildcard)
        if (StringTools.startsWith(name, rule))
          return true;
      return false;
    }
    final found = [];
    function walk(pack: String): Void {
      final prefix = pack == '' ? '' : pack + '.';
      for (cp in classPaths) {
        final path = pack == '' ? cp : cp + '/' + pack.split('.').join('/');
        if (!FileSystem.exists(path) || !FileSystem.isDirectory(path))
          continue;
        for (file in FileSystem.readDirectory(path)) {
          if (StringTools.endsWith(file, '.hx')
            && file.substr(0, file.length - 3).indexOf('.') < 0) {
            if (file == 'import.hx')
              continue;
            final name = prefix + file.substr(0, file.length - 3);
            if (skip(name))
              continue;
            found.push(name);
          } else if (recursive && FileSystem.isDirectory(path + '/' + file)
            && !skip(prefix + file))
            walk(prefix + file);
        }
      }
    }
    walk(pack);
    return found;
  }

  /** A string literal without interpolation, or `null`. */
  static function stringOf(expr: Expr): Null<String> {
    return switch expr.expr {
      case EConst(CString(value, kind)): kind == SingleQuotes && value.indexOf('$') >= 0 ? null : value;
      default: null;
    }
  }

  static function boolOf(expr: Expr): Literal<Bool> {
    return switch expr.expr {
      case EConst(CIdent('true')): Given(true);
      case EConst(CIdent('false')): Given(false);
      case EConst(CIdent('null')): IsNull;
      default: Unreadable;
    }
  }

  static function stringsOf(expr: Expr): Literal<Array<String>> {
    return switch expr.expr {
      case EConst(CIdent('null')): IsNull;
      case EArrayDecl(values):
        final strings = [];
        for (value in values) {
          final text = stringOf(value);
          if (text == null)
            return Unreadable;
          strings.push(text);
        }
        Given(strings);
      default: Unreadable;
    }
  }

  /** A class name as Haxe reads a plain argument: identifiers joined by dots. */
  static function isDottedPath(text: String): Bool {
    return ~/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.match(text);
  }

  static function compareStrings(left: String, right: String): Int {
    return left < right ? -1 : left > right ? 1 : 0;
  }
}

/** An argument of an `include` call as Genes reads it. */
private enum Literal<T> {
  /** The call does not give the argument. */
  Absent;

  /** The argument is `null`: the default value. */
  IsNull;

  Given(value: T);

  /** The argument is not a literal that Genes can read. */
  Unreadable;
}
#end
