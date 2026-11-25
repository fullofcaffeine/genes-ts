package genes.incremental;

#if macro
import genes.incremental.HaxeArguments.HaxeArgument;
import genes.incremental.ModuleRequest.SourceStat;
import haxe.macro.Context;
import haxe.macro.Expr;
import sys.FileSystem;

/**
 * A module that an `include` line adds but that has no declaration in the
 * program, with the content digest of its file. Example: a file that is
 * all `#if macro ... #end`. Haxe parses it and adds nothing, so no other
 * fact of the stored program names its file.
 */
typedef EmptyIncludedModule = {
  final module: String;
  final file: String;
  final digest: String;
}

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

  /** The modules of `modules` without a declaration in the program. */
  final empty: Array<EmptyIncludedModule>;
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
   * Why Genes cannot know every root, one text per reason; empty when it
   * knows them. Example: an argument out of its place
   * (`include('app', ['x'])`, where Haxe skips the optional `Bool`), or an
   * option that Genes does not know.
   */
  final unknown: Array<String>;
}

/** The literal arguments of one `include` call. */
private typedef IncludeCall = {
  final pack: String;
  final recursive: Bool;
  final ignore: Null<Array<String>>;
  final classPaths: Array<String>;

  /** False when `include` adds nothing (a display request other than `usage`). */
  final active: Bool;
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
 * changing the files in the included folders (a new or removed file, or a
 * file without a declaration that gets one), so a module request lists the
 * folders again and refuses when the list differs (`include-changed`,
 * `includeFailure`). A changed argument of the program changes
 * `programDigest`, which the session key holds, so such a request is
 * refused with `session-changed`.
 *
 * The contract with the client: a module request may leave out only the
 * roots that this class reads: `--main`, class-name arguments and
 * `--macro include(...)` lines with literal arguments. Every other macro
 * that adds modules must stay in the module request.
 *
 * How it reads the arguments: `Compiler.getConfiguration().args`, with HXML
 * files and `-lib` arguments already expanded, through `HaxeArguments.read`,
 * which knows every Haxe 4.3.7 option and both forms of a value
 * (`--macro include('app')` and `--macro=include('app')`). The roots are
 * unknown, so every module request is refused (`include-changed`), when an
 * argument is not readable (an option outside the table), when the list has
 * `--next`, `--each` or `--run`, or when an `include` line has an argument
 * that Genes cannot read in its place (Haxe 4.3.7 takes only constant
 * arguments in an init macro, but it skips an optional argument whose type
 * does not fit: `include('app', ['x'])` takes `['x']` as `ignore`). Under `-dce full` a missed `include` line would
 * not be refused by another rule: a new `@:keep` class in its folder can
 * keep a field of the requested module.
 *
 * How it finds the modules of an `include` line: `includedFiles` is a port
 * of the file walk of `haxe.macro.Compiler.include` in Haxe 4.3.7. Haxe
 * runs that walk after every init macro (`Context.onAfterInitMacros`), so
 * the place of the line before or after `genes.Generator.use()` does not
 * change it. Genes walks the folders when `genes.Generator.use()` runs
 * (`beginRequest`, before Haxe's walk) and again after the commit (`read`).
 * A listed module with declarations in the program was added. A listed
 * module without one must have a file whose status did not change between
 * the two walks; Genes keeps its digest, and a module request refuses when
 * the file changes. Any other listed module (a file added while the request
 * ran) makes the roots unknown until the next full request.
 *
 * What it does not claim: an init macro other than `include` that loads a
 * module by name is not read; such a module is not counted as staying, so
 * the request is refused under `-dce std` (`module-may-leave`).
 */
class ProgramRoots {
  static final STOP_OPTIONS = ['--run', '--next', '--each'];

  static final INCLUDE_CALL = 'haxe.macro.Compiler.include';

  /**
   * The status of each file that the `include` lines of this request
   * listed when `genes.Generator.use()` ran (`beginRequest`). Request-local.
   */
  static var beginStatus: Map<String, SourceStat> = new Map();

  /**
   * Walks the folders of the `include` lines of this request and keeps the
   * status of each listed file (`beginStatus`). `ModuleRequest.beginRequest`
   * calls it for a full request with module records, while
   * `genes.Generator.use()` runs: before Haxe's own walk, which runs after
   * every init macro.
   */
  public static function beginRequest(): Void {
    beginStatus = new Map();
    final configuration = haxe.macro.Compiler.getConfiguration();
    if (configuration == null)
      return;
    for (argument in HaxeArguments.read(configuration.args))
      switch argument {
        case Option('--macro', text)
          if (text != null && ModuleRequest.initMacroCall(text) == INCLUDE_CALL):
          final call = includeCallOf(text);
          if (call != null && call.active)
            for (found in includedFiles(call)) {
              final stat = ModuleRequest.statusOf(found.file, 0);
              if (stat != null)
                beginStatus.set(found.file, stat);
            }
        default:
      }
  }

  /**
   * Reads the class-name arguments and the `include` lines of this request,
   * and lists the modules that each `include` line adds. `observed` names
   * every module of the program (`GenerationChangeSet.observedModules`).
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
    final classNames = [];
    final includes = [];
    final unknown = [];
    for (argument in HaxeArguments.read(configuration.args)) {
      switch argument {
        case Unreadable(text, reason):
          unknown.push('Genes cannot read the argument `$text`: $reason');
        case Option(name, _) if (STOP_OPTIONS.indexOf(name) >= 0):
          unknown.push('Genes does not read the arguments after $name');
        case Option('--macro', text) if (text != null):
          final call = ModuleRequest.initMacroCall(text);
          if (call == INCLUDE_CALL) {
            final include = includeOf(text, inProgram);
            switch include {
              case Left(reason):
                unknown.push(reason);
              case Right(root):
                includes.push(root);
            }
          } else if (call == null && text.indexOf('include') >= 0)
            unknown.push('Genes cannot read the call of `$text`');
        case Option(_, _):
        case Plain(text):
          if (StringTools.endsWith(text, '.hxml'))
            unknown.push('Genes cannot read the HXML file $text');
          else if (isDottedPath(text))
            classNames.push(text);
      }
    }
    beginStatus = new Map();
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
   * modules, and the content of each listed module without a declaration.
   * Example: a new file `app/domain/Tag.hx` under
   * `include('app.domain', false)` gives
   * "`include('app.domain', false)` now adds app.domain.Tag".
   */
  public static function includeFailure(facts: ProgramRootsFacts): Null<String> {
    if (facts.unknown.length > 0)
      return facts.unknown[0];
    for (include in facts.includes) {
      final now = [
        for (found in includedFiles({
          pack: include.pack,
          recursive: include.recursive,
          ignore: include.ignore,
          classPaths: include.classPaths,
          active: true
        }))
          found.module
      ];
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
      for (empty in include.empty)
        if (ModuleRequest.readSource(empty.file).digest != empty.digest)
          return '`${include.text}` adds ${empty.module}, which had no '
            + 'declaration, and its file changed';
    }
    return null;
  }

  /** One text per root, sorted by kind, for the records text (`ModuleRequest.recordsText`). */
  public static function text(facts: ProgramRootsFacts): String {
    final buffer = new StringBuf();
    for (name in facts.classNames)
      buffer.add('root class $name\n');
    for (include in facts.includes) {
      buffer.add('root include ${include.text} ${include.modules.join(' ')}\n');
      for (empty in include.empty)
        buffer.add('root empty ${empty.module} ${empty.digest}\n');
    }
    for (reason in facts.unknown)
      buffer.add('root unknown $reason\n');
    return buffer.toString();
  }

  /**
   * Reads the `include` line `text` and lists its modules (`Right`), or
   * returns why Genes cannot know them (`Left`). A listed module must have
   * a declaration in the program (`inProgram`), or a file that did not
   * change since `beginRequest` (its digest is kept).
   */
  static function includeOf(text: String,
      inProgram: Map<String, Bool>): haxe.ds.Either<String, IncludeRoot> {
    final call = includeCallOf(text);
    if (call == null)
      return Left('Genes cannot read the arguments of `$text`');
    final files = call.active ? includedFiles(call) : [];
    final modules = [];
    final empty = [];
    for (found in files) {
      modules.push(found.module);
      if (inProgram.exists(found.module))
        continue;
      final before = beginStatus.get(found.file);
      final content = ModuleRequest.readSource(found.file);
      final stat = content.stat;
      if (before == null || stat == null
        || !ModuleRequest.sameStatus(before, stat))
        return
          Left('`$text` lists ${found.module}, which is not in the program, '
          + 'and its file changed while the request ran');
      empty.push({module: found.module, file: found.file,
        digest: content.digest});
    }
    modules.sort(compareStrings);
    return Right({
      text: text,
      pack: call.pack,
      recursive: call.recursive,
      ignore: call.ignore,
      classPaths: call.classPaths,
      modules: modules,
      empty: empty
    });
  }

  /**
   * Reads the literal arguments of the `include` call in `text`, or returns
   * `null` when an argument is not a literal that Genes can read: a string,
   * `true`, `false`, `null`, or an array of strings, each in its place.
   * Example: `include('p', ['x'])` gives `null`, because the second
   * argument must be a `Bool`.
   */
  static function includeCallOf(text: String): Null<IncludeCall> {
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
      case NotLiteral: return null;
    };
    final ignoreValue = switch ignore {
      case Absent | IsNull: null;
      case Given(value): value;
      case NotLiteral: return null;
    };
    final classPaths = switch paths {
      case Absent | IsNull: normalizedClassPaths();
      case Given(value): value;
      case NotLiteral: return null;
    };
    switch strict {
      case NotLiteral:
        return null;
      default:
    }
    // Without `classPaths`, `include` adds nothing in a display request
    // other than `usage`.
    final display = Context.definedValue('display');
    final active = switch paths {
      case Absent | IsNull if (display != null && display != 'usage'): false;
      default: true;
    };
    return {
      pack: pack,
      recursive: recursiveValue,
      ignore: ignoreValue,
      classPaths: classPaths,
      active: active
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
   * Returns the modules that `haxe.macro.Compiler.include` loads with
   * `Context.getModule` for `call`, each with its file, in the order of the
   * walk: a port of its file walk in Haxe 4.3.7. Each `.hx` file whose name
   * has no other dot, other than `import.hx`, is a module; with `recursive`,
   * each subfolder is included too. An `ignore` entry that ends with `*`
   * skips every module and folder whose path starts with the rest; another
   * entry skips that exact path. Example: `include('app', true, ['app.old*'])`
   * leaves out `app.old.Tool` and `app.oldest.Tool`.
   */
  static function includedFiles(call: IncludeCall): Array<{
    module: String,
    file: String
  }> {
    final ignore = call.ignore;
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
      for (cp in call.classPaths) {
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
            found.push({module: name, file: path + '/' + file});
          } else if (call.recursive
            && FileSystem.isDirectory(path
              + '/'
              + file) && !skip(prefix + file))
            walk(prefix + file);
        }
      }
    }
    walk(call.pack);
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
      default: NotLiteral;
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
            return NotLiteral;
          strings.push(text);
        }
        Given(strings);
      default: NotLiteral;
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
  NotLiteral;
}
#end
