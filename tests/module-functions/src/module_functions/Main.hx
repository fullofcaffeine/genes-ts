package module_functions;

import module_functions.Selected.SecondarySelected;
import module_functions.Inheritance.ModuleFunctionChild;

/** Executes admitted runtime behavior without target-specific escape syntax. */
class Main {
  static function main(): Void {
    final transcript = [
      Selected.before(),
      Selected.selected({label: "typed"}, null, "a", "b"),
      Std.string(Selected.recursive(3)),
      Std.string(Selected.sameName(1)),
      Std.string(Selected.callsCross(1)),
      Std.string(CrossModule.initialized),
      Std.string(ModuleFunctionChild.inherited),
      Std.string(Selected.callsPrivate(39)),
      Std.string(Selected.localStatic()),
      Std.string(Selected.localStatic()),
      Std.string(Selected.renamed(21)),
      Selected.after(),
      Selected.initialized,
      Selected.classInitialized,
      Std.string(SecondarySelected.selected(1))
    ];
    trace(transcript.join("|"));
  }
}
