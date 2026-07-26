package dual;

import dual.CoreTypes.Box;
import dual.CoreTypes.Mode;
import dual.CoreTypes.Transformer;
import dual.CoreTypes.UpperTransformer;
import haxe.ds.StringMap;

/**
 * Target-neutral semantic trace shared by all four JavaScript oracles.
 *
 * Why: generated source equality would reject harmless printer improvements
 * while missing runtime drift hidden behind snapshot updates. This scenario
 * instead records ordered, stable facts covering the language/runtime seams
 * both Genes emitters must preserve.
 *
 * What: classes, generics, interfaces, enums, nullable values, maps,
 * iterators, exceptions, evaluation order, local mutability, expression-valued
 * switch, a real Node import, embedded resources, and reflection.
 *
 * How: every observation becomes one deterministic string. Map keys are sorted
 * before recording so the oracle never relies on host enumeration order.
 */
class CoreScenario {
  public static function run():Array<String> {
    final events:Array<String> = [];
    final box = new Box<String>("alpha");
    final transformer:Transformer<String> = new UpperTransformer();

    events.push('class:${box.value}');
    events.push('interface:${transformer.transform(box.value)}');
    events.push('enum:${Std.string(Mode.Careful("audit"))}');

    final nullable:Null<String> = null;
    events.push('null:${nullable == null}');

    final map = new StringMap<Int>();
    map.set("beta", 2);
    map.set("alpha", 1);
    final keys = [for (key in map.keys()) key];
    keys.sort(compareStrings);
    events.push('map:${map.get("missing") == null}:${keys.join(",")}:${map.get("beta")}');

    var sum = 0;
    for (value in [1, 2, 3])
      sum += value;
    events.push('iterator:$sum');

    try {
      throw new haxe.Exception("boom");
    } catch (error:haxe.Exception) {
      events.push('exception:${error.message}');
    }

    events.push('evaluation:${evaluationOrder()}');
    events.push('locals:${localDeclarations()}');
    final selected = switch 2 {
      case 1: "one";
      case 2: "two";
      default: "other";
    };
    events.push('switch:$selected');
    events.push('import:${NodePosix.join("dual", "mode")}');

    final resource = haxe.Resource.getString("dual.message");
    if (resource == null)
      throw new haxe.Exception("dual.message resource is missing");
    events.push('resource:${StringTools.trim(resource)}');

    events.push('reflection:${Type.getClassName(Type.getClass(box))}');
    return events;
  }

  static function evaluationOrder():String {
    final events:Array<String> = [];
    final result = receiver(events)[index(events)] += rightHandSide(events);
    return '${events.join(">")}:$result';
  }

  /**
   * Proves declaration mutability without relying on source `final` metadata.
   *
   * The public Haxe 4.3 typed-macro API omits that metadata, so Genes derives
   * `const` from the stronger complete-tree fact that a binding has an
   * initializer and no writes. This fixture keeps both negative controls:
   * `mutable` is reassigned directly, while `closureMutable` is reassigned from
   * a nested function. `assignedLater` has no declaration initializer and must
   * remain `let` even though it receives only one later value.
   */
  static function localDeclarations():String {
    final immutable = "fixed";
    var mutable = "before";
    mutable = "after";

    var assignedLater:String;
    if (chooseLater())
      assignedLater = "later";
    else
      assignedLater = "fallback";

    final captured = "captured";
    final closure = () -> captured;
    var closureMutable = 0;
    final increment = () -> closureMutable++;
    increment();

    function decorate(value:String):String
      return '$value!';

    final doubled = [for (value in [1, 2]) value * 2];
    final matched = switch {label: "pattern"} {
      case {label: label}: label;
    };
    return '$immutable:$mutable:$assignedLater:${closure()}:$closureMutable:'
      + '${decorate(matched)}:${doubled.join(",")}';
  }

  static function chooseLater():Bool {
    return true;
  }

  static function receiver(events:Array<String>):Array<Int> {
    events.push("receiver");
    return [1];
  }

  static function index(events:Array<String>):Int {
    events.push("index");
    return 0;
  }

  static function rightHandSide(events:Array<String>):Int {
    events.push("rhs");
    return 2;
  }

  static function compareStrings(left:String, right:String):Int {
    if (left < right)
      return -1;
    return left > right ? 1 : 0;
  }
}
