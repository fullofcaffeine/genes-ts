# Dynamic-import runtime suffix fixture

`Genes.dynamicImport()` creates a real JavaScript `import()` request while Haxe
is typing the program. That request must name the file the runtime will load,
which is not always the source artifact Genes writes:

- generated `.ts` and `.tsx` source requests `.js`;
- classic `.jsx` also requests the JavaScript produced by the JSX transform;
- classic `.js` and `.mjs` request their own runtime extension; and
- the two documented no-extension defines remove the suffix.

The focused test builds the same source through every profile above. It also
runs the `.mjs` output, because a source-only assertion would not prove that
Node can resolve the generated request. The test explicitly includes
`dynamicimportpolicy.Target`: `Genes.dynamicImport()` names a runtime chunk,
but—as with other dynamic entry points—the application still owns retaining
that module in the generated program.

One owned Haxe server then repeats and switches the same profiles. Every warm
tree, including its ownership manifest and source map, must match the isolated
cold build byte-for-byte. This also protects a less obvious lifecycle rule:
cached declarations can retain older `@:genes.generate` stamps, and the current
request must remain selected even when more than one historical stamp exists.
The carrier itself is compiler-only, and the harness fails if its name reaches
generated output or if the request leaves a private stage or output sentinel.

See also:

- `docs/typescript-target/IMPORTS.md`, “Import specifiers”
- `yarn test:dynamic-import-policy`
