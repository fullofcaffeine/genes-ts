package directiveinvalid;

#if module_directive_arity
@:genes.moduleDirective("first", "second")
#elseif module_directive_nonliteral
@:genes.moduleDirective("computed" + "-mode")
#elseif module_directive_empty
@:genes.moduleDirective(" \t ")
#elseif module_directive_conflict
@:genes.moduleDirective("first-mode")
#end
class Main {
  public static function main(): Void {}
}

#if module_directive_conflict
@:genes.moduleDirective("second-mode")
var otherDirectiveOwner = "conflicting module field";
#end
