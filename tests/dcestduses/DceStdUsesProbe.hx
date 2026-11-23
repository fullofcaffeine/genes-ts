package tests.dcestduses;

#if macro
import genes.incremental.DceStdUses;
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Compile-time checks of `DceStdUses.importsOf`, which the `-dce std` rule
 * of a module request reads to know which modules a module's import and
 * using lines load (genes-f8vc.14.7).
 *
 * Why it matters: the rule refuses a structural edit when a module of the
 * program may leave a full build (`module-may-leave`). A line that this
 * reader names although Haxe does not load it (a commented line, a line
 * inside `#if`, a whole-package import) could make the rule think that a
 * module stays loaded when it does not, and a preview could keep a file that
 * cold no longer prints. A line that it misses only refuses a preview.
 *
 * Cases: plain, sub-type and enum-constructor imports, `using`, `as` and
 * `in` aliases, whole-package imports, comments, `#if` blocks, metadata and
 * a declaration that end the header, and a repeated module.
 *
 * `test.hxml` runs this probe, so `yarn test` fails when a case fails.
 */
class DceStdUsesProbe {
  public static macro function validate(): Expr {
    same(DceStdUses.importsOf('package app;\nimport app.ui.Button;\nclass X {}\n'),
      ['app.ui.Button'], 'a plain import');
    same(DceStdUses.importsOf('import app.Leaf.Kind;\nimport app.Leaf.Kind.Small;\nclass X {}\n'),
      ['app.Leaf'],
      'sub-type and enum-constructor imports name their module once');
    same(DceStdUses.importsOf('using StringTools;\nusing app.Tools.Extra;\nclass X {}\n'),
      ['StringTools', 'app.Tools'], 'using lines');
    same(DceStdUses.importsOf('import app.ui.Button as B;\nimport app.ui.Badge in C;\nclass X {}\n'),
      ['app.ui.Button', 'app.ui.Badge'], 'aliases');
    same(DceStdUses.importsOf('import app.ui.*;\nimport app.*;\nclass X {}\n'),
      [], 'a whole-package import loads nothing');
    same(DceStdUses.importsOf('// import app.Gone;\n/* import app.Hidden; */\nimport app.Kept;\nclass X {}\n'),
      ['app.Kept'], 'comments');
    same(DceStdUses.importsOf('#if debug\nimport app.Debug;\n#else\nimport app.Release;\n#end\nimport app.Always;\nclass X {}\n'),
      ['app.Always'], 'lines inside #if');
    same(DceStdUses.importsOf('import app.A;\n@:keep class X {\n}\nimport app.After;\n'),
      ['app.A'], 'metadata starts the declarations');
    same(DceStdUses.importsOf('import app.A;\nclass X {\n  static function f() return 1;\n}\nimport app.After;\n'),
      ['app.A'], 'a declaration ends the header');
    same(DceStdUses.importsOf('package  app ;\nimport\n  app.ui.Button\n  ;\nfinal x = 1;\n'),
      ['app.ui.Button'],
      'spaces and line breaks inside lines, and a module-level field');
    return macro null;
  }

  #if macro
  static function same(found: Array<String>, expected: Array<String>,
      label: String): Void {
    if (found.join(',') != expected.join(','))
      Context.fatalError('DceStdUses.importsOf, $label: expected [${expected.join(', ')}], '
        + 'got [${found.join(', ')}]',
        Context.currentPos());
  }
  #end
}
