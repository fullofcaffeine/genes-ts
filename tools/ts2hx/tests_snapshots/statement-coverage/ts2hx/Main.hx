package ts2hx;

function main(): Void {
  var x: Float;
  var flag: Bool;
  x = 0;
  flag = false;
  while ((x < 3))   {
    x = (x + 1);
  }
  var y = 0;
  do   {
    y = (y + 1);
  } while ((y < 2));
  var label = "";
  {
    var __ts2hx_switch_value0 = y;
    var __ts2hx_switch_state1 = -1;
    if (__ts2hx_switch_state1 == -1 && genes.js.Equality.strict(__ts2hx_switch_value0, 0)) __ts2hx_switch_state1 = 0;
    if (__ts2hx_switch_state1 == -1 && genes.js.Equality.strict(__ts2hx_switch_value0, 1)) __ts2hx_switch_state1 = 1;
    if (__ts2hx_switch_state1 == -1 && genes.js.Equality.strict(__ts2hx_switch_value0, 2)) __ts2hx_switch_state1 = 2;
    if (__ts2hx_switch_state1 == -1) __ts2hx_switch_state1 = 3;
    if (__ts2hx_switch_state1 >= 0) do {
      if (__ts2hx_switch_state1 <= 0) {
        label = "zero";
        break;
      }
      if (__ts2hx_switch_state1 <= 1) {
      }
      if (__ts2hx_switch_state1 <= 2) {
        label = "small";
        break;
      }
      if (__ts2hx_switch_state1 <= 3) {
        label = "other";
        break;
      }
    } while (false);
  }
  var acc = 0;
  var i = 0;
  while (true)   {
    i = (i + 1);
    if ((i == 2))     {
      continue;
    }
    if ((i == 4))     {
      break;
    }
    acc = (acc + i);
  }
  trace(x);
  trace(y);
  trace(label);
  trace(acc);
  trace(flag);
}
