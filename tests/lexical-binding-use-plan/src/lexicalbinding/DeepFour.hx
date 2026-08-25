package lexicalbinding;

/** Four lexical descendants provide the small structural-count control. */
function deepFour(): Void {
  function levelOne(): Void {
    function levelTwo(): Void {
      function levelThree(): Void {
        function levelFour(): Void {
          trace("four");
        }
        levelFour();
      }
      levelThree();
    }
    levelTwo();
  }
  levelOne();
}
