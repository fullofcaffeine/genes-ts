package lexicalbinding;

@:genes.moduleFunction("setStateLazyTwo")
function setStateLazyTwo(): String {
  return "lazy-two-function";
}

class LazyTwo {
  public static function value(): String {
    return "lazy-two-type";
  }
}
