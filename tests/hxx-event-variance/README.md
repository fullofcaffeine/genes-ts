# HXX event callback variance evidence

React chooses the event value passed to a property callback. For example,
`<a onClick>` supplies a mouse event whose target is an anchor element. A
handler is safe when it accepts that exact value or something broader:

- `MouseEvent<AnchorElement>` is the exact contract;
- `MouseEvent<DomElement>` accepts a broader target;
- `SyntheticEvent<AnchorElement>` accepts a broader event family;
- `SyntheticEvent<DomElement>` accepts both broader dimensions.

The positive fixture also uses ordinary Haxe class and generic-interface
inheritance. That keeps the rule useful for typed component contracts without
making two unrelated empty externs compatible.

The reverse is unsafe. A generic DOM click cannot be sent to a handler that
requires an anchor, and a generic synthetic submit event cannot be sent to a
handler that requires a mouse event. Sibling event families and sibling target
elements are also unrelated.

`yarn test:hxx-event-variance` proves those directions in Haxe before output,
checks canonical React types with TypeScript 5/6/7, executes TypeScript and
classic JavaScript, and confirms failed builds preserve an existing output.
