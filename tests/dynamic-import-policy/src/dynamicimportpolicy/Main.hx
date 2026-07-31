package dynamicimportpolicy;

import genes.Genes;
import dynamicimportpolicy.Target.dynamicSelected;
#if dynamic_import_binding_collision
import dynamicimportpolicy.Target.reservedHandlerBinding;
#elseif dynamic_import_type_collision
import dynamicimportpolicy.foo.MyClass as LazyType;
import dynamicimportpolicy.Target.lazyTypeBinding;
#elseif dynamic_import_aliases
import dynamicimportpolicy.foo.MyClass as FooClass;
import dynamicimportpolicy.bar.MyClass as BarClass;
#end

/**
 * Exercises the legacy `Genes.dynamicImport()` helper with one local module.
 *
 * The helper runs while Haxe is typing this method, before Genes writes output
 * files. The focused test changes output profiles and extensions around this
 * same source so a stale or artifact-shaped suffix becomes directly visible.
 */
class Main {
  static function main(): Void {
    #if dynamic_import_type_collision
    Genes.dynamicImport((LazyType, Target) -> {
      trace(new LazyType().toString());
      trace(lazyTypeBinding());
    });
    #elseif dynamic_import_aliases
    Genes.dynamicImport((FooClass, BarClass) -> {
      trace(new FooClass().toString());
      trace(new BarClass().toString());
      trace(FooClass.label());
      trace(BarClass.label());
    });
    #else
    Genes.dynamicImport(Target -> {
      trace(Target.value());
      trace(dynamicSelected());
      final dynamicSelected = "dynamic-handler-local";
      trace(dynamicSelected);
      #if dynamic_import_binding_collision
      trace(reservedHandlerBinding());
      #end
    });
    #end
  }
}
