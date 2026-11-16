package inc;

#if macro
import haxe.macro.Context;
import sys.FileSystem;

/**
 * Makes a request fail at a chosen place while a flag file exists in the
 * working folder: `fail-on-generate.flag` fails in an `onGenerate` callback
 * (after typing, before Genes generates), and `fail-after-generate.flag`
 * fails in an `onAfterGenerate` callback (after Genes published the tree and
 * stored its cache).
 */
class FailMacro {
  public static function install(): Void {
    Context.onGenerate(_ -> {
      if (FileSystem.exists('fail-on-generate.flag'))
        Context.error('fixture failure in onGenerate', Context.currentPos());
    });
    Context.onAfterGenerate(() -> {
      if (FileSystem.exists('fail-after-generate.flag'))
        Context.error('fixture failure after generation', Context.currentPos());
    });
  }
}
#end
