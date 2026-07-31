# Genes-owned Haxe modules

This directory contains Haxe-facing compatibility modules owned by the Genes
compiler distribution.

Copied JavaScript standard-library modules use Haxe's native platform suffix:

```text
src/<Haxe module path>.js.hx
```

Every such overlay must be registered in
[`config/stdlib-overrides.json`](../../config/stdlib-overrides.json). The
manifest pins its Haxe provenance and exact allowed edits; a task-specific
fixture must prove the semantic reason for the override.

Read [`docs/STDLIB_OVERRIDES.md`](../../docs/STDLIB_OVERRIDES.md) before adding
or updating one. Existing Genes-specific modules in this directory are not
automatically copied-stdlib overlays, and must not be added to the manifest
unless they actually replace a pinned upstream module.
