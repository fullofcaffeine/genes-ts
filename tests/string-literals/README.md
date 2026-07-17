# String-literal code-unit evidence

This fixture answers one narrow compiler question: does a Haxe string literal
arrive in generated JavaScript or TypeScript with the same runtime UTF-16 code
units?

The comparison deliberately uses code-unit numbers instead of screenshots or
visual text. That catches corrupted non-ASCII bytes, emoji surrogate changes,
combining-mark drift, control-character loss, and U+2028/U+2029 parsing issues.
The same source runs through standard Haxe JS, classic Genes, and genes-ts;
when `../genes-vanilla` is available, original Genes is a second oracle. A
present `../haxe.elixir.codex/vendor/genes` is also executed so the downstream
indexed-walk change is measured rather than inferred from its source diff.

`scripts/test-string-literals.ts` also checks the generated source spelling and
maps a Unicode expression literal and the module-level metadata literal back to
their Haxe lines. The fixture is generic compiler evidence and contains no
Reflaxe.Elixir or application-specific behavior.
