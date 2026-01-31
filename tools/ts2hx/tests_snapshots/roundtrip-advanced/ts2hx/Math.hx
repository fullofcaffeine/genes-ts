package ts2hx;

final clamp = function(x: Float, min: Float, max: Float) {
  if ((x < min))   {
    return min;
  }
  if ((x > max))   {
    return max;
  }
  return x;
};
