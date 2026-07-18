import foo.Util as RootUtil;
import a.foo.Util as NestedUtil;

class OverlapMain {
  static function main(): Void
    trace(RootUtil.value() + NestedUtil.value());
}
