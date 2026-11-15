import NativeTwins.FactoryA;
import NativeTwins.FactoryB;
import NativeTwins.LibA;
import NativeTwins.LibB;

/**
 * Calls two classes that share one native name, in two orders.
 *
 * The annotation of one class must not reach the other class, whichever
 * class the emitter sees first. `-D a_first` makes the unannotated class the
 * first one.
 */
class NativeTwinsMain {
  static function main() {
    #if a_first
    LibA.other();
    final viaOverload: Array<String> = LibB.over();
    trace(viaOverload);
    #end
    LibB.plain();
    final first: Null<Int> = LibA.make(null);
    final second: Null<Int> = LibB.make(null);
    LibA.other();
    final third: Null<Int> = LibA.make(null);
    trace(first, second, third);

    #if a_first
    final inferred: Null<Int> = FactoryA.build(null);
    FactoryB.ready();
    final explicit: Null<Int> = FactoryB.build(null);
    #else
    FactoryB.ready();
    final inferred: Null<Int> = FactoryA.build(null);
    final explicit: Null<Int> = FactoryB.build(null);
    #end
    trace(inferred, explicit);
  }
}
