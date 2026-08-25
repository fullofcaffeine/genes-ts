package lexicalbinding;

import genes.Genes;
#if genes.lexical_binding_inventory
import genes.internal.LexicalBindingQueryMarker.mark;
#end

/** Direct runtime root used only by the query-decision probe. */
@:native("queryRoot.Value")
extern class QueryRoot {}

/** Exact declaration, use, function, case, root, and opacity query shapes. */
function queryScopes(input: Int): Void {
  #if genes.lexical_binding_inventory
  mark("outer", "declaration", ["queryRoot", "missing"]);
  #end
  final anchor = input;
  trace(QueryRoot);

  function captured(): Void {
    #if genes.lexical_binding_inventory
    mark("outer", "function-capture", []);
    mark("outer", "use", []);
    #end
    trace(anchor);
  }
  function sibling(): Void {
    #if genes.lexical_binding_inventory
    mark("outer", "function-sibling", []);
    #end
    trace("sibling");
  }

  switch input {
    case 0:
      #if genes.lexical_binding_inventory
      mark("outer", "scope-capture", []);
      mark("outer", "use", []);
      #end
      trace(anchor);
    case 1:
      #if genes.lexical_binding_inventory
      mark("outer", "scope-sibling", []);
      #end
      trace("case-sibling");
    default:
  }
  js.Syntax.code("void 0");
  captured();
  sibling();
}

/** An opaque expression in a sibling function is not a descendant. */
function queryClean(input: Int): Void {
  #if genes.lexical_binding_inventory
  mark("clean", "declaration", ["queryRoot", "missing"]);
  #end
  final anchor = input;
  #if genes.lexical_binding_inventory
  mark("clean", "use", []);
  #end
  trace(anchor);
}

/** The same host authority has one exact root spelling per profile. */
function queryHost(input: Int): Void {
  #if genes.lexical_binding_inventory
  mark("host", "declaration", ["Error", "globalThis"]);
  #end
  final anchor = input;
  trace(js.lib.Error);
  #if genes.lexical_binding_inventory
  mark("host", "use", []);
  #end
  trace(anchor);
}

/** Only the dynamic callback that contains the use can shadow it. */
function queryDynamic(input: Int): Void {
  #if genes.lexical_binding_inventory
  mark("dynamic", "declaration", ["LazyOne", "LazyTwo"]);
  #end
  final anchor = input;
  Genes.dynamicImport(LazyOne -> {
    #if genes.lexical_binding_inventory
    mark("dynamic", "use", []);
    #end
    trace(anchor);
  });
  Genes.dynamicImport(LazyTwo -> {
    trace("dynamic-sibling");
  });
}

function retainQueryCases(): Void {
  queryScopes(0);
  queryClean(0);
  queryHost(0);
  queryDynamic(0);
}
