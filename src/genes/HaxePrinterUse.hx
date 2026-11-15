package genes;

#if macro
import haxe.Json;
import haxe.io.Path;
import haxe.macro.Context;
import sys.FileSystem;
import sys.io.File;

/**
 * Reports which modules were printed, in part, by Haxe's own JavaScript
 * printer instead of by Genes.
 *
 * Why: Genes prints almost every expression itself. For a few raw-code forms
 * it used to hand the expression to Haxe's stock printer
 * (`JSGenApi.generateStatement` and `generateValue`, stored as
 * `genes.Context.expr` and `genes.Context.value`). That printer is a black
 * box: Genes cannot tell which names, types, or compiler settings its text
 * depends on. Incremental generation therefore cannot prove that such a module
 * is unchanged, and must print it again after every edit. A build needs a way
 * to say how many modules still take that path, and which ones.
 *
 * What: an opt-in report. Add this init macro to a build:
 *
 * ```hxml
 * --macro genes.HaxePrinterUse.report('build/haxe-printer-use.json')
 * ```
 *
 * After a successful generation the file holds, for example:
 *
 * ```json
 * {"format":"genes.haxe-printer-use/v1","modules":468,"haxePrinterModules":1,"haxePrinterModuleNames":["haxe.Resource"]}
 * ```
 *
 * `modules` counts the modules that Genes printed in this request.
 * `haxePrinterModules` and `haxePrinterModuleNames` use the same names as the
 * incremental shadow report, so both reports can be compared directly.
 *
 * How: `Module.createContext` passes every new printer context to `watch`.
 * With the report enabled, `watch` wraps the two printer callbacks and records
 * the module name before it calls Haxe. Without the init macro, `watch`
 * returns at once and the build runs exactly as before. The report is not a
 * compiler output: it is written outside the output transaction, only after
 * generation succeeded, and a failed build leaves the previous file untouched.
 * The path is relative to the working directory of the Haxe process.
 *
 * See also: `tests/syntax-code-forms/README.md`, which lists the raw-code
 * forms and names the one form that still uses Haxe's printer.
 */
@:noCompletion
class HaxePrinterUse {
  public static inline final REPORT_FORMAT = 'genes.haxe-printer-use/v1';

  static var reportFile: Null<String> = null;
  static var watched: Map<String, Bool> = new Map();
  static var modules: Map<String, Bool> = new Map();

  /**
   * Enables the report for this compilation request.
   *
   * Call it as an init macro. Haxe runs init macros again for every request
   * of a compilation server, so each request starts with an empty record and
   * registers its own after-generation callback.
   */
  public static function report(file: String): Void {
    reportFile = file;
    watched = new Map();
    modules = new Map();
    Context.onAfterGenerate(write);
  }

  /**
   * Records `module` whenever one of its expressions reaches Haxe's printer.
   *
   * The wrapped callbacks return exactly what Haxe returned, so the generated
   * text cannot change.
   */
  public static function watch(context: genes.Context, module: String): Void {
    if (reportFile == null)
      return;
    watched.set(module, true);
    final statement = context.expr;
    final value = context.value;
    context.expr = expression -> {
      modules.set(module, true);
      return statement(expression);
    };
    context.value = expression -> {
      modules.set(module, true);
      return value(expression);
    };
  }

  static function write(): Void {
    final file = reportFile;
    if (file == null)
      return;
    final names = [for (name in modules.keys()) name];
    names.sort(Reflect.compare);
    final directory = Path.directory(file);
    if (directory.length > 0 && !FileSystem.exists(directory))
      FileSystem.createDirectory(directory);
    // The text is built by hand so that the key order is the same in every
    // Haxe version; `Json.stringify` follows the interpreter's field order.
    File.saveContent(file,
      '{"format":${Json.stringify(REPORT_FORMAT)},"modules":${Lambda.count(watched)},' +
      '"haxePrinterModules":${names.length},' +
      '"haxePrinterModuleNames":${Json.stringify(names)}}\n');
  }
}
#end
