package ts2hx;

/**
 * Compiler-internal abrupt completion for translated try/finally.
 *
 * Why: a source return, break, or continue cannot directly leave the
 * synthetic callbacks used to run a finalizer exactly once.
 * What: null represents normal callback completion; enum values carry only
 * the typed transfer that still belongs to an enclosing source target.
 * How: genes.js.FinallyCompletion applies finalizer precedence, then ts2hx
 * statically dispatches or propagates the result. Host throws stay throws.
 * Genes keeps this type local to implementation and omits declarations,
 * runtime registration, public exports, and source mappings.
 */
@:genes.compilerInternal
private enum __Ts2hxFinallyAbrupt<T> {
  ReturnValue(value:T);
  ReturnVoid;
  BreakTo(target:Int);
  ContinueTo(target:Int);
}

final events: Array<String> = [];

var localIndex = 0;

var localSteps = 0;

function advanceLocalLoop(): Void {
  (function() {
  var __ts2hx_old0 = localSteps;
  var __ts2hx_rhs1 = 1;
  return localSteps = (__ts2hx_old0 + __ts2hx_rhs1);
})();
  (function() {
  var __ts2hx_old2 = localIndex;
  var __ts2hx_rhs3 = 1;
  return localIndex = (__ts2hx_old2 + __ts2hx_rhs3);
})();
}

function localTarget(): Void {
  genes.js.TryFinally.run(
    function() {
      {
        localIndex = 0;
        while ((localIndex < 2)) {
          final __ts2hx_completion4:Null<__Ts2hxFinallyAbrupt<Void>> =
            genes.js.FinallyCompletion.run(
              function():Null<__Ts2hxFinallyAbrupt<Void>> {
                events.push(("local:body:" + localIndex));
                if (genes.js.Equality.strict(localIndex, 0))                 {
                  return __Ts2hxFinallyAbrupt.ContinueTo(1);
                }
                return __Ts2hxFinallyAbrupt.BreakTo(1);
                return null;
              },
              function():Null<__Ts2hxFinallyAbrupt<Void>> {
                events.push(("local:inner:" + localIndex));
                return null;
              }
            );
          switch (__ts2hx_completion4) {
            case __Ts2hxFinallyAbrupt.BreakTo(__ts2hx_break_target):
              switch (__ts2hx_break_target) {
                case 1:
                  break;
                default:
                  throw new haxe.Exception("ts2hx received an unplanned break target.");
              }
            case __Ts2hxFinallyAbrupt.ContinueTo(__ts2hx_continue_target):
              switch (__ts2hx_continue_target) {
                case 1:
                  advanceLocalLoop();
                  continue;
                default:
                  throw new haxe.Exception("ts2hx received an unplanned continue target.");
              }
            case null:
              {}
            default:
              throw new haxe.Exception("ts2hx received an unplanned completion variant.");
          }
          advanceLocalLoop();
        }
      }
      events.push("local:after-loop");
    },
    function() {
      events.push("local:outer");
    }
  );
  events.push(("local:steps:" + localSteps));
}

function outerTarget(): Void {
  {
    var index = 0;
    while ((index < 2)) {
      final __ts2hx_completion5:Null<__Ts2hxFinallyAbrupt<Void>> =
        genes.js.FinallyCompletion.run(
          function():Null<__Ts2hxFinallyAbrupt<Void>> {
            final __ts2hx_completion6:Null<__Ts2hxFinallyAbrupt<Void>> =
              genes.js.FinallyCompletion.run(
                function():Null<__Ts2hxFinallyAbrupt<Void>> {
                  events.push(("outer:body:" + index));
                  if (genes.js.Equality.strict(index, 0))                   {
                    return __Ts2hxFinallyAbrupt.ContinueTo(1);
                  }
                  return __Ts2hxFinallyAbrupt.BreakTo(1);
                  return null;
                },
                function():Null<__Ts2hxFinallyAbrupt<Void>> {
                  events.push(("outer:inner:" + index));
                  return null;
                }
              );
            if (__ts2hx_completion6 != null) return __ts2hx_completion6;
            return null;
          },
          function():Null<__Ts2hxFinallyAbrupt<Void>> {
            events.push(("outer:finally:" + index));
            return null;
          }
        );
      switch (__ts2hx_completion5) {
        case __Ts2hxFinallyAbrupt.BreakTo(__ts2hx_break_target):
          switch (__ts2hx_break_target) {
            case 1:
              break;
            default:
              throw new haxe.Exception("ts2hx received an unplanned break target.");
          }
        case __Ts2hxFinallyAbrupt.ContinueTo(__ts2hx_continue_target):
          switch (__ts2hx_continue_target) {
            case 1:
              index++;
              continue;
            default:
              throw new haxe.Exception("ts2hx received an unplanned continue target.");
          }
        case null:
          {}
        default:
          throw new haxe.Exception("ts2hx received an unplanned completion variant.");
      }
      index++;
    }
  }
  events.push("outer:after-loop");
}

function switchTargets(): Void {
  final __ts2hx_break_target = "source-break";
  final __ts2hx_continue_target = "source-continue";
  events.push(("switch:names:" + __ts2hx_break_target + ":" + __ts2hx_continue_target));
  {
    var __ts2hx_switch_value7 = 1;
    var __ts2hx_switch_state8 = -1;
    if (__ts2hx_switch_state8 == -1 && genes.js.Equality.strict(__ts2hx_switch_value7, 1)) __ts2hx_switch_state8 = 0;
    if (__ts2hx_switch_state8 == -1) __ts2hx_switch_state8 = 1;
    if (__ts2hx_switch_state8 >= 0) do {
      if (__ts2hx_switch_state8 <= 0) {
        final __ts2hx_completion9:Null<__Ts2hxFinallyAbrupt<Void>> =
          genes.js.FinallyCompletion.run(
            function():Null<__Ts2hxFinallyAbrupt<Void>> {
              events.push("switch:break-body");
              return __Ts2hxFinallyAbrupt.BreakTo(1);
              return null;
            },
            function():Null<__Ts2hxFinallyAbrupt<Void>> {
              events.push("switch:break-finally");
              return null;
            }
          );
        switch (__ts2hx_completion9) {
          case __Ts2hxFinallyAbrupt.BreakTo(__ts2hx_break_target2):
            switch (__ts2hx_break_target2) {
              case 1:
                break;
              default:
                throw new haxe.Exception("ts2hx received an unplanned break target.");
            }
          case null:
            {}
          default:
            throw new haxe.Exception("ts2hx received an unplanned completion variant.");
        }
      }
      if (__ts2hx_switch_state8 <= 1) {
        events.push("switch:unreachable");
        break;
      }
    } while (false);
  }
  events.push("switch:after-break");
  {
    var index = 0;
    while ((index < 2)) {
      {
        var __ts2hx_switch_value10 = index;
        var __ts2hx_switch_state11 = -1;
        var __ts2hx_switch_continue12 = false;
        if (__ts2hx_switch_state11 == -1 && genes.js.Equality.strict(__ts2hx_switch_value10, 0)) __ts2hx_switch_state11 = 0;
        if (__ts2hx_switch_state11 == -1) __ts2hx_switch_state11 = 1;
        if (__ts2hx_switch_state11 >= 0) do {
          if (__ts2hx_switch_state11 <= 0) {
            final __ts2hx_completion13:Null<__Ts2hxFinallyAbrupt<Void>> =
              genes.js.FinallyCompletion.run(
                function():Null<__Ts2hxFinallyAbrupt<Void>> {
                  events.push("switch:continue-body");
                  return __Ts2hxFinallyAbrupt.ContinueTo(2);
                  return null;
                },
                function():Null<__Ts2hxFinallyAbrupt<Void>> {
                  events.push("switch:continue-finally");
                  return null;
                }
              );
            switch (__ts2hx_completion13) {
              case __Ts2hxFinallyAbrupt.ContinueTo(__ts2hx_continue_target2):
                switch (__ts2hx_continue_target2) {
                  case 2:
                    __ts2hx_switch_continue12 = true;
                    break;
                  default:
                    throw new haxe.Exception("ts2hx received an unplanned continue target.");
                }
              case null:
                {}
              default:
                throw new haxe.Exception("ts2hx received an unplanned completion variant.");
            }
          }
          if (__ts2hx_switch_state11 <= 1) {
            events.push("switch:second");
            break;
          }
        } while (false);
        if (__ts2hx_switch_continue12) {
          index++;
          continue;
        }
      }
      events.push(("switch:after:" + index));
      index++;
    }
  }
}

function controlOverridesThrow(): Void {
  var index = 0;
  while ((index < 2))   {
    (function() {
  var __ts2hx_old14 = index;
  var __ts2hx_rhs15 = 1;
  return index = (__ts2hx_old14 + __ts2hx_rhs15);
})();
    final __ts2hx_completion16:Null<__Ts2hxFinallyAbrupt<Void>> =
      genes.js.FinallyCompletion.run(
        function():Null<__Ts2hxFinallyAbrupt<Void>> {
          events.push(("throw:body:" + index));
          throw new js.lib.Error(("protected:" + index));
          return null;
        },
        function():Null<__Ts2hxFinallyAbrupt<Void>> {
          events.push(("throw:finally:" + index));
          if (genes.js.Equality.strict(index, 1))           {
            return __Ts2hxFinallyAbrupt.ContinueTo(1);
          }
          return __Ts2hxFinallyAbrupt.BreakTo(1);
          return null;
        }
      );
    switch (__ts2hx_completion16) {
      case __Ts2hxFinallyAbrupt.BreakTo(__ts2hx_break_target):
        switch (__ts2hx_break_target) {
          case 1:
            break;
          default:
            throw new haxe.Exception("ts2hx received an unplanned break target.");
        }
      case __Ts2hxFinallyAbrupt.ContinueTo(__ts2hx_continue_target):
        switch (__ts2hx_continue_target) {
          case 1:
            continue;
          default:
            throw new haxe.Exception("ts2hx received an unplanned continue target.");
        }
      case null:
        {}
      default:
        throw new haxe.Exception("ts2hx received an unplanned completion variant.");
    }
  }
  events.push("throw:after-loop");
}

function main(): Void {
  localTarget();
  outerTarget();
  switchTargets();
  controlOverridesThrow();
  final actual = events.join("|");
  final expected = ["local:body:0", "local:inner:0", "local:body:1", "local:inner:1", "local:after-loop", "local:outer", "local:steps:1", "outer:body:0", "outer:inner:0", "outer:finally:0", "outer:body:1", "outer:inner:1", "outer:finally:1", "outer:after-loop", "switch:names:source-break:source-continue", "switch:break-body", "switch:break-finally", "switch:after-break", "switch:continue-body", "switch:continue-finally", "switch:second", "switch:after:1", "throw:body:1", "throw:finally:1", "throw:body:2", "throw:finally:2", "throw:after-loop"].join("|");
  if (!(genes.js.Equality.strict(actual, expected)))   {
    throw new js.lib.Error(("Unexpected completion trace: " + actual));
  }
  trace(("FINALLY_CONTROL_OK:" + actual));
}
