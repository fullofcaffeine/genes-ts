package module_function_invalid;

#if module_value_iife_forward_read
/** Negative control: an IIFE reads a later `const` during initialization. */
@:genes.moduleValue("first")
final first = (() -> second)();

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_callable_value_forward_read
/**
 * A function-valued direct module `const` remains an exact synchronous target.
 *
 * Merely declaring `readSecond` is safe. Calling it while the following
 * `second` binding is still uninitialized is not.
 */
@:genes.moduleValue("readSecond")
final readSecond = () -> second;

@:genes.moduleValue("first")
final first = readSecond();

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_local_closure_forward_read
/**
 * Negative control: a locally named closure still runs during initialization.
 */
@:genes.moduleValue("first")
final first = {
  final read = () -> second;
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_argument_callee_forward_read
/**
 * JavaScript saves the callee before evaluating call arguments.
 *
 * `replace()` changes the local for future reads, but this call still invokes
 * the original closure that reads the later module value.
 */
@:genes.moduleValue("first")
final first = {
  var read = (_: Int) -> second;
  final replace = () -> {
    read = (_: Int) -> 0;
    return 1;
  };
  read(replace());
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_reassigned_closure_forward_read
/**
 * Negative control: branch exits retain every callback that can reach a call.
 *
 * A lexical walk sees the safe `else` callback last. Runtime control flow can
 * still choose the unsafe `then` callback, so source visitation order cannot
 * decide which body owns `read`.
 */
@:genes.moduleValue("first")
final first = {
  var read = () -> 0;
  if (Date.now().getTime() > 0) {
    read = () -> second;
  } else {
    read = () -> 0;
  }
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_virtual_instance_forward_read
/**
 * A base-typed receiver can dispatch to an overriding method at runtime.
 *
 * The planner cannot treat the base declaration as the sole call target while
 * the class and method remain overridable.
 */
class VirtualForwardBase {
  public function new() {}

  public function readSecond(): Int {
    return 0;
  }
}

class VirtualForwardChild extends VirtualForwardBase {
  public function new() {
    super();
  }

  override public function readSecond(): Int {
    return second;
  }
}

@:genes.moduleValue("first")
final first = {
  final helper: VirtualForwardBase = new VirtualForwardChild();
  helper.readSecond();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_called_closure_mutation_forward_read
/**
 * A called local closure can replace another captured callback immediately.
 * That exact assignment must flow back to the caller before `read()` runs.
 */
@:genes.moduleValue("first")
final first = {
  var read = () -> 0;
  final replace = () -> {
    read = () -> second;
  };
  replace();
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_zero_iteration_closure_forward_read
/**
 * Negative control: a loop body may not execute even once.
 *
 * The unsafe pre-loop callback therefore remains a possible target after the
 * loop, despite the safe replacement appearing later in source order.
 */
@:genes.moduleValue("first")
final first = {
  var read = () -> second;
  while (Date.now().getTime() < 0)
    read = () -> 0;
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_switch_closure_forward_read
/** Negative control: switch case visitation order is not runtime flow. */
@:genes.moduleValue("first")
final first = {
  var read = () -> 0;
  switch Date.now().getTime() > 0 {
    case true:
      read = () -> second;
    case false:
      read = () -> 0;
  }
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_try_closure_forward_read
/**
 * Negative control: a catch can run after an unsafe callback assignment.
 *
 * The try can also complete normally, leaving the unsafe callback in place.
 * A lexical walk that visits the safe catch last must not erase that normal
 * exit.
 */
@:genes.moduleValue("first")
final first = {
  var read = () -> 0;
  try {
    read = () -> second;
    if (Date.now().getTime() < 0)
      throw "force-catch";
  } catch (_:String) {
    read = () -> 0;
  }
  read();
};

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_function_forward_read
/**
 * Negative control: a direct function called by an initializer reads a later
 * ESM value immediately, even though a function that is merely stored would
 * defer the read safely.
 */
@:genes.moduleFunction("readSecond")
function readSecond(): Int {
  return second;
}

@:genes.moduleValue("first")
final first = readSecond();

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_class_static_forward_read
/**
 * A named class in the same `.hx` module is emitted into the same ES module.
 * Calling its static method during initialization therefore has the same
 * temporal-dead-zone risk as calling a direct module function.
 */
class StaticForwardHelper {
  public static function readSecond(): Int {
    return second;
  }
}

@:genes.moduleValue("first")
final first = StaticForwardHelper.readSecond();

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_callback_argument_forward_read
/**
 * An exact same-module helper can invoke a callback parameter immediately.
 * The validator connects the call argument to that exact Haxe parameter.
 */
class CallbackForwardHelper {
  public static function invoke(callback: () -> Int): Int {
    return callback();
  }
}

@:genes.moduleValue("first")
final first = CallbackForwardHelper.invoke(() -> second);

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_instance_method_forward_read
/** An exact same-module instance method is also a synchronous call target. */
final class InstanceForwardHelper {
  public function new() {}

  public function readSecond(): Int {
    return second;
  }
}

@:genes.moduleValue("first")
final first = new InstanceForwardHelper().readSecond();

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_constructor_forward_read
/**
 * Constructing a same-module class executes its constructor synchronously.
 * The constructor body must therefore participate in forward-read validation.
 */
class ConstructorForwardHelper {
  public final value: Int;

  public function new() {
    value = second;
  }
}

@:genes.moduleValue("first")
final first = new ConstructorForwardHelper().value;

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_forward_read
/** Negative control: ESM cannot read a later `const` during initialization. */
@:genes.moduleValue("first")
final first = second;

@:genes.moduleValue("second")
final second = 2;

#elseif module_value_class_static
/** Negative control: class static identity is not a module-level value. */
@:keep
class ModuleValueInvalid {
  @:genes.moduleValue("value")
  public static final value = 1;
}
#else
#if module_value_arity
@:genes.moduleValue
#elseif module_value_arity_multiple
@:genes.moduleValue("value", "other")
#elseif module_value_nonliteral
@:genes.moduleValue(BINDING)
#elseif module_value_empty
@:genes.moduleValue("")
#elseif module_value_identifier
@:genes.moduleValue("await")
#elseif module_value_public_name
@:genes.moduleValue("renamedValue")
#elseif module_value_native_name
@:native("nativeValue")
@:genes.moduleValue("value")
#elseif module_value_dual_marker
@:genes.moduleFunction("value")
@:genes.moduleValue("value")
#else
@:genes.moduleValue("value")
#end
#if module_value_mutable
var value = 1;
#elseif module_value_function
function value(): Int {
  return 1;
}
#else
final value = 1;
#end

#if module_value_mixed
/** Keeps ordinary synthetic-owner work beside the selected value. */
@:keep
function ordinary(): Int {
  return value + 1;
}
#end

#if module_value_function_collision
/** Proves functions and values compete in one real ESM binding namespace. */
@:keep
class ModuleValueFunctionCollision {
  @:genes.moduleFunction("value")
  public static function selected(): Int {
    return value;
  }
}
#end

#end
