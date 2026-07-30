package module_functions;

import module_functions.Selected.ConstructorNameControl;
import module_functions.Selected.SecondarySelected;
import module_functions.Inheritance.ModuleFunctionChild;
import module_functions.TopLevel.topLevelIdentity;
import module_functions.TopLevel.topLevelAsync;
import module_functions.TopLevel.firstMatchIndex;
import module_functions.TopLevel.metadata;
import module_functions.RegisterHelpers.appendWithBoundMethod;
import module_functions.ShadowedBindings.readMetadata;
import module_functions.ExposedValue.exposedValue;
import module_functions.LocalBindingImportCollision.foreignTitle;
import module_functions.LocalBindingImportCollision.identityPair;
import module_functions.TsRegisterHelpers.positive;
import module_functions.TsRegisterHelpers.forceReturn;
import module_functions.TsNullHelper.nullString;
import module_functions.TopLevelSibling.topLevelIdentity as siblingTopLevelIdentity;
import module_functions.TopLevelSibling.metadata as siblingMetadata;

/** Executes admitted runtime behavior without target-specific escape syntax. */
class Main {
  static function main(): Void {
    // Retain the async module binding; the focused native runtime assertion
    // below awaits its exact result without changing this sync transcript.
    topLevelAsync(1);
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
      metadata.title + ":" + metadata.tags.length,
      siblingMetadata.title,
      Std.string(firstMatchIndex(["first", "match"])),
      Std.string(appendWithBoundMethod([1, 2, 3])),
      readMetadata("parameter"),
      foreignTitle(),
      identityPair(),
      Std.string(positive(null)),
      forceReturn("return"),
      Std.string(nullString()),
      exposedValue
    ];
    trace(transcript.join("|"));
  }
}
