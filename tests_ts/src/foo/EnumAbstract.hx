package foo;

import js.html.RequestCache;

class EnumAbstract {
  public static function accepts(v: RequestCache): RequestCache {
    return v;
  }

  public static function demo(): RequestCache {
    return accepts(RequestCache.DEFAULT);
  }
}

