package my.app;

import genes.Register;
import genes.Register.HxRegistry;

class Main {
  static function main() {
    final _ = new MyClass(1);
    final __: MyEnum = MyEnum.B(2);

    final hxClasses: HxRegistry = Register.global("$hxClasses");
    final hxEnums: HxRegistry = Register.global("$hxEnums");

    final classKey = "my.app.MyClass";
    final enumKey = "my.app.MyEnum";

    if (Reflect.hasField(hxClasses, classKey))
      throw "minimal_runtime should not register classes in $hxClasses";
    if (Reflect.hasField(hxEnums, enumKey))
      throw "minimal_runtime should not register enums in $hxEnums";

    if (Type.resolveClass(classKey) != null)
      throw "minimal_runtime should make Type.resolveClass(...) return null";
    if (Type.resolveEnum(enumKey) != null)
      throw "minimal_runtime should make Type.resolveEnum(...) return null";

    final className = Type.getClassName(MyClass);
    if (className != classKey)
      throw 'minimal_runtime should keep Type.getClassName working (got $className)';

    trace("ok");
  }
}
