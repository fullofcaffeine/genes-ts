package lexicalbinding;

@:genes.moduleFunction("setStateLazyOne")
function setStateLazyOne(): String {
  return "lazy-one-function";
}

class LazyOne {
  public static function value(): String {
    return "lazy-one-type";
  }
}
