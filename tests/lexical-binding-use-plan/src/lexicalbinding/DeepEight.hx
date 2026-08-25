package lexicalbinding;

/** Eight lexical descendants must add linear plan work, not subtree rescans. */
function deepEight(): Void {
  function levelOne(): Void {
    function levelTwo(): Void {
      function levelThree(): Void {
        function levelFour(): Void {
          function levelFive(): Void {
            function levelSix(): Void {
              function levelSeven(): Void {
                function levelEight(): Void {
                  trace("eight");
                }
                levelEight();
              }
              levelSeven();
            }
            levelSix();
          }
          levelFive();
        }
        levelFour();
      }
      levelThree();
    }
    levelTwo();
  }
  levelOne();
}
