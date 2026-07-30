package module_functions;

import module_functions.Selected.ConstructorNameControl;
import module_functions.Selected.SecondarySelected;
import module_functions.Inheritance.ModuleFunctionChild;
import module_functions.TopLevelBind.extractTopLevelValue;
import module_functions.TopLevelMixed.mixedOrdinary;
import module_functions.TopLevelMixed.mixedSelected;
import module_functions.TopLevel.topLevelIdentity;
import module_functions.TopLevelSibling.topLevelIdentity as siblingTopLevelIdentity;

/** Executes admitted runtime behavior without target-specific escape syntax. */
class Main {
  static function main(): Void {
    final transcript = [
      Selected.before(),
      Selected.selected({label: "typed"}, null, "a", "b"),
      Selected.publicIdentity({label: "public"}).label,
      Std.string(Selected.publicByFieldName(1)),
      Std.string(Selected.recursive(3)),
      Std.string(Selected.sameName(1)),
      Std.string(Selected.callsCross(1)),
      Std.string(CrossModule.initialized),
      Std.string(ModuleFunctionChild.inherited),
      Std.string(Selected.callsPrivate(39)),
      Std.string(Selected.localStatic()),
      Std.string(Selected.localStatic()),
      Std.string(Selected.enumConstructorName(1)),
      Std.string(ConstructorNameControl.Ready),
      Selected.nullableDefault(),
      Std.string(Selected.renamed(21)),
      Selected.after(),
      Selected.initialized,
      Selected.classInitialized,
      Std.string(SecondarySelected.selected(1)),
      topLevelIdentity("top-level"),
      siblingTopLevelIdentity("top-level-sibling"),
      Std.string(extractTopLevelValue(new TopLevelReceiver(7))()),
      Std.string(mixedSelected() + mixedOrdinary)
    ];
    trace(transcript.join("|"));
  }
}
