# Discriminated Union Repro

This is an expected-failing genes-ts repro for `genes-27m`.

PiMonoHX DTOs expose Haxe typedefs that should become ergonomic TypeScript
discriminated unions. The generic compiler behavior needed here is:

- enum-abstract singletons used as object discriminants should emit as string
  literals such as `"text"`, not broad `string`;
- `haxe.extern.EitherType<A, B>` typedef aliases should emit as `A | B`, not
  `any`;
- declarations produced by `tsc` from genes-ts source output should preserve
  the same shape.

Run:

```bash
node tests/genes-ts/repros/discriminated-unions/check.mjs
```

