package genes.incremental;

#if macro
/**
 * One argument of a Haxe 4.3.7 command line, as `HaxeArguments.read` reads
 * it.
 */
enum HaxeArgument {
  /**
   * An option of the Haxe 4.3.7 option table, with its value, or `null`
   * for an option that takes none. `-D x`, `-D=x` and `--define x` give
   * the names `-D`, `-D` and `--define` with the value `x`.
   */
  Option(name: String, value: Null<String>);

  /** A plain argument: a class name (`app.Tool`) or an HXML file. */
  Plain(text: String);

  /**
   * An argument that Genes cannot read exactly, with the reason: an option
   * outside the table, an option that takes no value written with `=`, or
   * an option whose value is missing.
   */
  Unreadable(text: String, reason: String);
}

/**
 * Reads a Haxe 4.3.7 argument list (`Compiler.getConfiguration().args`)
 * into options with their values and plain arguments (genes-f8vc.14.12).
 *
 * Why: Haxe accepts an option and its value as two arguments
 * (`--macro include('app')`) or as one argument with `=`
 * (`--macro=include('app')`, `-D=x`, `--main=app.Main`), and it keeps the
 * second form as one argument in the list. A reader that only knows the
 * first form takes the next argument as the value of `-D=x`, and never sees
 * the `include` of `--macro=include(...)`. Example: in
 * `-D=probe --macro include('mr.inc')`, such a reader skips the include
 * line.
 *
 * What: every option of the Haxe 4.3.7 option table (`ARITY`, the same
 * table as `HAXE_4_3_7_OPTION_ARITY` of `tooling/src/hxml/inventory.ts`) is
 * read with its value. An argument that starts with `-` and is not in the
 * table is `Unreadable`, so a caller that must know every argument can
 * refuse. Haxe splits an argument with `=` at the first `=`.
 *
 * Not read here: the meaning of `--next`, `--each` and `--run`, which a
 * caller must handle (they start another compilation or end the list).
 */
class HaxeArguments {
  /** The number of values that each Haxe 4.3.7 option takes (0 or 1). */
  static final ARITY: Map<String, Int> = [
    '--js' => 1,
    '-js' => 1,
    '--lua' => 1,
    '-lua' => 1,
    '--swf' => 1,
    '-swf' => 1,
    '--neko' => 1,
    '-neko' => 1,
    '--php' => 1,
    '-php' => 1,
    '--cpp' => 1,
    '-cpp' => 1,
    '--cppia' => 1,
    '-cppia' => 1,
    '--cs' => 1,
    '-cs' => 1,
    '--java' => 1,
    '-java' => 1,
    '--jvm' => 1,
    '--python' => 1,
    '-python' => 1,
    '--hl' => 1,
    '-hl' => 1,
    '-x' => 1,
    '--interp' => 0,
    '--run' => 0,
    '-p' => 1,
    '--class-path' => 1,
    '-cp' => 1,
    '-m' => 1,
    '--main' => 1,
    '-main' => 1,
    '-L' => 1,
    '--library' => 1,
    '-lib' => 1,
    '-D' => 1,
    '--define' => 1,
    '-v' => 0,
    '--verbose' => 0,
    '--debug' => 0,
    '-debug' => 0,
    '--version' => 0,
    '-version' => 0,
    '-h' => 0,
    '--help' => 0,
    '-help' => 0,
    '--help-defines' => 0,
    '--help-user-defines' => 0,
    '--help-metas' => 0,
    '--help-user-metas' => 0,
    '--dce' => 1,
    '-dce' => 1,
    '--swf-version' => 1,
    '-swf-version' => 1,
    '--swf-header' => 1,
    '-swf-header' => 1,
    '--flash-strict' => 0,
    '--swf-lib' => 1,
    '-swf-lib' => 1,
    '--neko-lib-path' => 1,
    '--swf-lib-extern' => 1,
    '-swf-lib-extern' => 1,
    '--java-lib' => 1,
    '-java-lib' => 1,
    '--java-lib-extern' => 1,
    '--net-lib' => 1,
    '-net-lib' => 1,
    '--net-std' => 1,
    '-net-std' => 1,
    '--c-arg' => 1,
    '-c-arg' => 1,
    '-r' => 1,
    '--resource' => 1,
    '-resource' => 1,
    '--prompt' => 0,
    '-prompt' => 0,
    '--cmd' => 1,
    '-cmd' => 1,
    '--no-traces' => 0,
    '--next' => 0,
    '--each' => 0,
    '--display' => 1,
    '--xml' => 1,
    '-xml' => 1,
    '--json' => 1,
    '--no-output' => 0,
    '--times' => 0,
    '--no-inline' => 0,
    '--no-opt' => 0,
    '--remap' => 1,
    '--macro' => 1,
    '--server-listen' => 1,
    '--wait' => 1,
    '--server-connect' => 1,
    '--connect' => 1,
    '-C' => 1,
    '--cwd' => 1,
    '--haxelib-global' => 0,
    '-w' => 1
  ];

  /**
   * Returns the number of values (0 or 1) that the Haxe 4.3.7 option `name`
   * takes, or `null` when the table does not hold it. Example: `-D` gives
   * 1, `--no-output` gives 0.
   */
  public static function arity(name: String): Null<Int> {
    return ARITY.get(name);
  }

  /** Returns every option of the table, sorted (for the probe that compares it with the tooling table). */
  public static function optionNames(): Array<String> {
    final names = [for (name in ARITY.keys()) name];
    names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    return names;
  }

  /**
   * Returns the arguments of `args` in order, each option with its value.
   * Example: `["-cp=src", "--macro", "include('app')", "app.Tool"]` gives
   * `Option("-cp", "src")`, `Option("--macro", "include('app')")` and
   * `Plain("app.Tool")`.
   */
  public static function read(args: Array<String>): Array<HaxeArgument> {
    final found = [];
    var index = 0;
    while (index < args.length) {
      final arg = args[index++];
      if (!StringTools.startsWith(arg, '-')) {
        found.push(Plain(arg));
        continue;
      }
      final equals = arg.indexOf('=');
      final name = equals > 0 ? arg.substr(0, equals) : arg;
      final arity = ARITY.get(name);
      if (arity == null) {
        found.push(Unreadable(arg, 'Genes does not know the option $name'));
        continue;
      }
      if (equals > 0) {
        if (arity == 0)
          found.push(Unreadable(arg, 'the option $name takes no value'));
        else
          found.push(Option(name, arg.substr(equals + 1)));
        continue;
      }
      if (arity == 0) {
        found.push(Option(name, null));
        continue;
      }
      if (index >= args.length) {
        found.push(Unreadable(arg, 'the option $name has no value'));
        continue;
      }
      found.push(Option(name, args[index++]));
    }
    return found;
  }
}
#end
