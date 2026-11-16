package inc;

class Features {
  public static function sum(values: Array<Int>): Int {
    var total = 0;
    for (value in values)
      total += value;
    /*DYNAMIC_ITERATOR*/
    return total;
  }
}
