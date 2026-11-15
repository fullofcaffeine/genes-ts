package inc;

import inc.Chain.ChainA;

class ChainUser {
  public static function read(value: ChainA): String {
    return "chain:" + value.x;
  }
}
