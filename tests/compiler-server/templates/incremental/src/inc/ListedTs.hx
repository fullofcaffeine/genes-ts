package inc;

/**
 * A listed class: `ListedTs.value` uses it at run time, so dead-code
 * elimination keeps it and it is in the generator's list. `inc.ListedUser`
 * names it only in a type position. `inc.Mark3Macro` writes
 * `@:ts.type("string")` on it after typing (`markListedClassMeta`), which
 * removes the edge from `inc.ListedUser` to it although no member list and
 * no stamp changes (review of the merge of genes-ts #246 into slice S2).
 */
class ListedBox {
  public function new() {}

  public function tag(): String {
    return "box";
  }
}

class ListedTs {
  public static function value(): String {
    return new ListedBox().tag();
  }
}
