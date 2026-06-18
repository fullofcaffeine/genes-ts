package tests;

import tink.unit.Assert.*;

class TestTempLocals {
  public function new() {}

  public function testSiblingComprehensionTemps() {
    final words = ["a", "b"];
    final nums = [1, 2];
    final out = if (words.length > 1) {
      [for (word in words) word.toUpperCase()];
    } else {
      [for (num in nums) Std.string(num)];
    }
    return assert(out.join(",") == "A,B");
  }

  public function testSequentialComprehensionTemps() {
    final nums = [1, 2];
    final words = [for (num in nums) Std.string(num)];
    final marked = [for (word in words) word + "!"];
    return assert(marked.join(",") == "1!,2!");
  }
}
