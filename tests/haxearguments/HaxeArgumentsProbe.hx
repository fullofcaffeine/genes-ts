package tests.haxearguments;

#if macro
import genes.incremental.HaxeArguments;
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Compile-time checks of `HaxeArguments.read`, which `ProgramRoots` uses to
 * find the class-name arguments and the `--macro include(...)` lines of a
 * full request (genes-f8vc.14.12).
 *
 * Why it matters: a module request leaves those roots out, and it counts
 * the modules that they add as staying in the program. A reader that takes
 * the wrong argument as a value can miss an include line, and under
 * `-dce full` a preview can then differ from cold (review of #269:
 * `-D=x --macro include(...)`). An argument that the reader does not know
 * must be `Unreadable`, so that `ProgramRoots` refuses.
 *
 * Cases: a value with `=` inline and as the next argument, a value that
 * holds `=`, an option without a value written with `=`, an option that is
 * not in the table, a missing value, and a plain argument. The probe also
 * checks that the table equals `HAXE_4_3_7_OPTION_ARITY` of
 * `tooling/src/hxml/inventory.ts`, so the two readers of Haxe arguments
 * cannot drift apart.
 *
 * `test.hxml` runs this probe, so `yarn test` fails when a case fails.
 */
class HaxeArgumentsProbe {
  public static macro function validate(): Expr {
    same(['-D=a=b'], 'option -D a=b', 'a value with = inline');
    same(['-D', 'a=b'], 'option -D a=b', 'a value as the next argument');
    same(['--macro=include(\'mr.inc\',false)'],
      'option --macro include(\'mr.inc\',false)', 'an inline --macro value');
    same(['--no-output=1'], 'unreadable --no-output=1',
      'a value on an option that takes none');
    same(['--no-output', 'app.Tool'], 'option --no-output - | plain app.Tool',
      'an option that takes no value, then a class name');
    same(['--bogus', 'app.Tool'], 'unreadable --bogus | plain app.Tool',
      'an option that is not in the table');
    same(['-cp'], 'unreadable -cp', 'a missing value');
    same(['-D=probe', 'app.Tool'], 'option -D probe | plain app.Tool',
      'an inline value does not take the next argument');
    sameTable();
    return macro null;
  }

  #if macro
  static function same(args: Array<String>, expected: String,
      label: String): Void {
    final found = [
      for (argument in HaxeArguments.read(args))
        switch argument {
          case Option(name, value):
            'option $name ${value == null ? '-' : value}';
          case Plain(text):
            'plain $text';
          case Unreadable(text, _):
            'unreadable $text';
        }
    ].join(' | ');
    if (found != expected)
      Context.fatalError('HaxeArguments.read, $label: expected "$expected", got "$found"',
        Context.currentPos());
  }

  /** Compares the table with `HAXE_4_3_7_OPTION_ARITY` of the tooling. */
  static function sameTable(): Void {
    final text = sys.io.File.getContent('tooling/src/hxml/inventory.ts');
    final start = text.indexOf('HAXE_4_3_7_OPTION_ARITY');
    final end = start < 0 ? -1 : text.indexOf('});', start);
    if (start < 0 || end < 0)
      Context.fatalError('HaxeArgumentsProbe: HAXE_4_3_7_OPTION_ARITY not found',
        Context.currentPos());
    final entry = ~/"(-[^"]+)":\s*([01])/;
    var rest = text.substring(start, end);
    final tooling = new Map<String, Int>();
    while (entry.match(rest)) {
      tooling.set(entry.matched(1), Std.parseInt(entry.matched(2)) ?? -1);
      rest = entry.matchedRight();
    }
    final names = [for (name in tooling.keys()) name];
    names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    if (names.join(' ') != HaxeArguments.optionNames().join(' '))
      Context.fatalError('HaxeArguments: the options differ from HAXE_4_3_7_OPTION_ARITY',
        Context.currentPos());
    for (name in names)
      if (HaxeArguments.arity(name) != tooling.get(name))
        Context.fatalError('HaxeArguments: $name takes ${HaxeArguments.arity(name)} values, '
          + 'HAXE_4_3_7_OPTION_ARITY says ${tooling.get(name)}',
          Context.currentPos());
  }
  #end
}
