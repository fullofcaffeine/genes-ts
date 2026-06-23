package foo;

import js.html.RequestCache;

typedef CacheLeaf = {
  final cache: RequestCache;
};

typedef CacheRecord = {
  final cache: RequestCache;
  final nested: CacheLeaf;
};

class EnumAbstract {
  static final ClassField: RequestCache = RequestCache.RELOAD;

  public static function accepts(v: RequestCache): RequestCache {
    return v;
  }

  static function select(): RequestCache {
    return RequestCache.NO_CACHE;
  }

  public static function demo(): RequestCache {
    return accepts(RequestCache.DEFAULT);
  }

  public static function localDemo(): RequestCache {
    final cache: RequestCache = select();
    return accepts(cache);
  }

  public static function fieldLocalDemo(): RequestCache {
    final cache: RequestCache = ClassField;
    return accepts(cache);
  }

  public static function recordValue(): CacheRecord {
    return {
      cache: RequestCache.FORCE_CACHE,
      nested: {
        cache: RequestCache.ONLY_IF_CACHED
      }
    };
  }

  public static function recordDemo(): String {
    final records: Array<CacheRecord> = [recordValue()];
    final cache: RequestCache = records[0].cache;
    final nestedCache: RequestCache = records[0].nested.cache;
    return accepts(ClassField) + ":" + accepts(cache) + ":" + accepts(nestedCache);
  }

  public static function arrayLoopDemo(): String {
    var count = 0;
    for (cache in [RequestCache.DEFAULT, RequestCache.RELOAD]) {
      accepts(cache);
      count++;
    }
    return Std.string(count);
  }
}
