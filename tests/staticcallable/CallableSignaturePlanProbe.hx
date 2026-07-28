package tests.staticcallable;

#if macro
import genes.CallableSignaturePlan;
import haxe.macro.Context;
import haxe.macro.Expr;
import haxe.macro.Type;
#end

/**
 * Compile-time controls for static callable generic planning.
 *
 * The checks run at macro time because they need the compiler's structured
 * `Type` and `KTypeParameter` values. For example, the class parameter named
 * `T` and the method parameter also named `T` are two different compiler
 * declarations even though their source text is identical. A generated
 * TypeScript file cannot reveal that identity after both have been printed.
 *
 * This probe therefore constructs a compiler-only signature containing both
 * declarations and checks that the plan names them `T` and `T_1`. It does not
 * add an invalid assignment to the Haxe program: Haxe would reject such source
 * before Genes could generate TypeScript. Separate TypeScript consumers test
 * that the generated public method accepts valid calls and rejects invalid
 * ones.
 */
class CallableSignaturePlanProbe {
  public static macro function validate(): Expr {
    final collisionOwner = classType("tests.staticcallable.CollisionOwner");
    final collisionMethod = collisionOwner.statics.get()
      .filter(field -> field.name == "identity")[0];
    final ownerParameter = collisionOwner.params[0];
    final methodParameter = collisionMethod.params[0];
    final combined = TFun([
      {
        name: "ownerValue",
        opt: false,
        t: ownerParameter.t
      },
      {
        name: "methodValue",
        opt: false,
        t: methodParameter.t
      }
    ], methodParameter.t);
    final collisionPlan = CallableSignaturePlan.build(collisionOwner,
      combined, [methodParameter], true);
    final collisionParameters = collisionPlan.parameters();
    require(collisionParameters.length == 2,
      "Same-named owner and method parameters were collapsed");
    require(collisionPlan.nameFor(parameterDeclaration(ownerParameter)) == "T",
      "The first exact T identity did not retain its readable name");
    require(collisionPlan.nameFor(parameterDeclaration(methodParameter)) == "T_1",
      "The second exact T identity did not receive a collision-safe name");

    final ordinaryPlan = CallableSignaturePlan.build(collisionOwner,
      collisionMethod.type, collisionMethod.params, true);
    require(ordinaryPlan.parameters().length == 1,
      "An ordinary declared method parameter was projected twice");

    final constrainedOwner = classType("tests.staticcallable.ConstrainedOwner");
    final valueParameter = constrainedOwner.params[1];
    final constrainedPlan = CallableSignaturePlan.build(constrainedOwner, TFun([
      {
        name: "value",
        opt: false,
        t: valueParameter.t
      }
    ], valueParameter.t), [], true);
    final constrainedParameters = constrainedPlan.parameters();
    require(constrainedParameters.length == 2,
      "A free parameter's constraint dependency was not closed");
    require(constrainedParameters[0].name == "Element"
      && constrainedParameters[1].name == "Value",
      "Owner constraint closure did not preserve declaration order");

    final propertyPlan = CallableSignaturePlan.build(collisionOwner,
      ownerParameter.t, [], false);
    require(propertyPlan.isEmpty(),
      "A static property incorrectly acquired callable type parameters");
    return macro null;
  }

  #if macro
  static function classType(path: String): ClassType {
    return switch Context.getType(path) {
      case TInst(reference, _): reference.get();
      default:
        Context.error('$path is not a class', Context.currentPos());
    }
  }

  static function parameterDeclaration(parameter: TypeParameter): ClassType {
    return switch parameter.t {
      case TInst(reference, _): reference.get();
      default:
        Context.error('${parameter.name} is not a compiler type parameter',
          Context.currentPos());
    }
  }

  static function require(condition: Bool, message: String): Void {
    if (!condition)
      Context.error(message, Context.currentPos());
  }
  #end
}
