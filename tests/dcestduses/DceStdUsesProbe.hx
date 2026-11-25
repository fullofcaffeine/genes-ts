package tests.dcestduses;

#if macro
import genes.incremental.DceStdUses;
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Compile-time checks of `DceStdUses.importsOf`, which the `-dce std` rule
 * of a module request reads to know which modules a module's import and
 * using lines load (genes-f8vc.14.7), and of the text tests of
 * `DceStdUses.privateReachOf` (genes-zbva).
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
 * `privateReachOf` must find `@:privateAccess` code and `import <Type>.*`
 * lines, where a new private field of another module can change how the
 * code types. A text that it misses could publish a stale preview; a
 * `privateAccess` in a comment only refuses one. `untyped` is read from
 * Haxe's `:has_untyped` mark of a field, not from the text, so a comment
 * with `untyped` does not count (the module gate covers the mark).
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
    reach('has @:privateAccess code',
      'class X {\n  static function f(g: G) return @:privateAccess g.label();\n}\n',
      '@:privateAccess around a call');
    reach('has @:privateAccess code',
      'class X {\n  static function f() @:privateAccess {\n    return 1;\n  }\n}\n',
      '@:privateAccess on a function body');
    reach('has @:privateAccess code',
      '// @:privateAccess was here\nclass X {}\n',
      'a comment with privateAccess still counts');
    reach(null,
      'class X {\n  static function f(g: G) return untyped g.label();\n}\n',
      'untyped in the text alone (Haxe marks such a field :has_untyped)');
    reach(null, '// this was untyped once\nclass X {}\n',
      'a comment with untyped does not count');
    reach(null, 'class X {\n  static function f(g: G) return g.label();\n}\n',
      'no private access');
    reach('imports the static fields of a type (`import <Type>.*`)',
      'import app.Dial.*;\nclass X {}\n', 'import <Type>.*');
    reach('imports the static fields of a type (`import <Type>.*`)',
      '#if debug\nimport app.Dial.Knob.*;\n#end\nclass X {}\n',
      'import <Type>.* inside #if');
    reach(null, 'import app.ui.*;\nusing app.Tools;\nclass X {}\n',
      'a whole-package import and a using line');
    reach('has no readable source', null, 'no source text');
    return macro null;
  }

  #if macro
  static function reach(expected: Null<String>, text: Null<String>,
      label: String): Void {
    final found = DceStdUses.privateReachOf([], text);
    if (found != expected)
      Context.fatalError('DceStdUses.privateReachOf, $label: expected $expected, got $found',
        Context.currentPos());
  }

  static function same(found: Array<String>, expected: Array<String>,
      label: String): Void {
    if (found.join(',') != expected.join(','))
      Context.fatalError('DceStdUses.importsOf, $label: expected [${expected.join(', ')}], '
        + 'got [${found.join(', ')}]',
        Context.currentPos());
  }
  #end
}
