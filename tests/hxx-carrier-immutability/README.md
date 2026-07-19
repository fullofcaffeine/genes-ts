# HXX carrier immutability evidence

HXX macros use small linked records so Haxe can type every property and child
before Genes emits JSX or `createElement`. Those records are compiler
scaffolding: application code may supply the values they contain, but it must
not change their property names, links, or values after construction.

The positive program keeps local carrier records untouched and proves that a
value with a side effect is still evaluated exactly once in TypeScript and
classic JavaScript output. The negative program mutates property and child
carriers directly, then mutates a property carrier through the same alias chain
that feeds the JSX marker. Both profiles must report `GTS-JSX-INTENT-010` at
the mutation before replacing the sentinel output file.

Before this guard, Haxe accepted a property-name mutation and Genes emitted
both of these statements:

```ts
props.__genesJsxPropName = "data-after"
React.createElement("div", {title: props.__genesJsxPropValue})
```

The assignment ran, but the JSX still used the original `title` name recovered
from the initializer. Rejecting the extra carrier use prevents that silent
compile-time/runtime disagreement.
