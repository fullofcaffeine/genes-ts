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
import module_functions.TsRegisterHelpers.assignOverride;
import module_functions.TsRegisterHelpers.missingValue;
import module_functions.TsNullHelper.nullString;
import module_functions.ModuleInit.moduleInitValue;
import module_functions.ModuleValueHelpers.branchCallbackValue;
import module_functions.ModuleValueHelpers.callbackArgumentValue;
import module_functions.ModuleValueHelpers.calledClosureMutationValue;
import module_functions.ModuleValueHelpers.constructorHelperValue;
import module_functions.ModuleValueHelpers.loopCallbackValue;
import module_functions.ModuleValueHelpers.staticHelperValue;
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
      assignOverride({
        value: "before"
      },
        "after"),
      Std.string(missingValue()),
      Std.string(nullString()),
      moduleInitValue(),
      Std.string(staticHelperValue),
      Std.string(constructorHelperValue),
      Std.string(callbackArgumentValue),
      Std.string(calledClosureMutationValue),
      Std.string(branchCallbackValue),
      Std.string(loopCallbackValue),
      exposedValue
    ];
    #if module_function_global_feature
    // Activates Haxe's compiler-wide `js.Lib.global` feature. Every runtime
    // module then receives a `$global = Register.$global` prologue, including
    // direct-only modules whose own typed expressions never mention it.
    js.Lib.global;
    #end
    trace(transcript.join("|"));
  }
}
