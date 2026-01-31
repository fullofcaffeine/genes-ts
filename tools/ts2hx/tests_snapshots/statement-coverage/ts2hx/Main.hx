package ts2hx;

function main(): Void {
  var x: Float = 0;
  var flag: Bool = false;
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
  switch (y) {
    case 0:
      {
      label = "zero";
      }
    case 1, 2:
      {
      label = "small";
      }
    default:
      {
      label = "other";
      }
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
