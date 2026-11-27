package tests.haxedependencies;

#if macro
import genes.incremental.HaxeDependencies;
import haxe.macro.Context;
import haxe.macro.Expr;
#end

/**
 * Compile-time checks of `HaxeDependencies.scan`, the one-pass reader of
 * Haxe's module dependency lists (genes-f8vc.14.35).
 *
 * Why it matters: the `module-may-leave` rule of a module request counts a
 * module as staying through the lines of these lists. Haxe writes them in
 * text mode, so on Windows each line ends with `\r\n` and a path uses `\`.
 * A reader that misses an entry gives no edge (every request is refused);
 * a reader that merges or splits entries could count a file once that Haxe
 * lists twice, which the rule relies on to skip modules made by macros.
 *
 * Cases: Unix lines, with a dependency listed twice and an entry that is
 * not wanted; Windows lines read as Windows (separators become `/`) and as
 * another system (only the `\r` is dropped); a file that is an entry twice;
 * a last line without `\n`.
 *
 * `test.hxml` runs this probe, so `yarn test` fails when a case fails.
 */
class HaxeDependenciesProbe {
  public static macro function validate(): Expr {
    same('/p/mr/A.hx:\n\t/p/mr/B.hx\n\t/p/mr/B.hx\n/p/mr/C.hx:\n\t/p/mr/A.hx\n',
      ['/p/mr/A.hx'], false,
      'entries /p/mr/A.hx=1 /p/mr/C.hx=1 | /p/mr/A.hx: /p/mr/B.hx /p/mr/B.hx',
      'Unix lines, one wanted entry');
    same('C:\\p\\mr\\A.hx:\r\n\tC:\\p\\mr\\B.hx\r\n', ['C:/p/mr/A.hx'], true,
      'entries C:/p/mr/A.hx=1 | C:/p/mr/A.hx: C:/p/mr/B.hx',
      'Windows lines read on Windows');
    same('C:\\p\\mr\\A.hx:\r\n\tC:\\p\\mr\\B.hx\r\n', ['C:\\p\\mr\\A.hx'],
      false, 'entries C:\\p\\mr\\A.hx=1 | C:\\p\\mr\\A.hx: C:\\p\\mr\\B.hx',
      'Windows lines read on another system keep their separators');
    same('/p/mr/A.hx:\n\t/p/mr/B.hx\n/p/mr/A.hx:\n', null, false,
      'entries /p/mr/A.hx=2 | /p/mr/A.hx: /p/mr/B.hx | /p/mr/A.hx:',
      'a file that is an entry twice');
    same('/p/mr/A.hx:\n\t/p/mr/B.hx', null, false,
      'entries /p/mr/A.hx=1 | /p/mr/A.hx: /p/mr/B.hx',
      'a last line without a line end');
    return macro null;
  }

  #if macro
  static function same(text: String, wanted: Null<Array<String>>,
      windows: Bool, expected: String, label: String): Void {
    final scanned = HaxeDependencies.scan(text,
      wanted == null ? null : [for (file in wanted) file => true], windows);
    final names = [for (file in scanned.entries.keys()) file];
    names.sort((left, right) -> left < right ? -1 : left > right ? 1 : 0);
    final parts = [
      'entries ' +
      [for (file in names) '$file=${scanned.entries.get(file)}'].join(' ')
    ];
    for (block in scanned.blocks)
      parts.push(StringTools.trim('${block.file}: ${block.lines.join(' ')}'));
    final found = parts.join(' | ');
    if (found != expected)
      Context.fatalError('HaxeDependenciesProbe: $label: expected "$expected", found "$found"',
        Context.currentPos());
  }
  #end
}
