# Watch orchestration conformance v1

This corpus names the framework-neutral behaviors required by Haxe-to-JS/TS
hosts that inventory HXML, reconcile filesystem changes, and serialize rebuild
requests.

Every vector has one operational description and a closed expected result.
Host adapters may add configuration files, cause types, fingerprints, build
retention, services, and diagnostics, but they must execute the same behaviors
without translating another framework's concepts.

The families are:

- `hxml`: pure inventory from explicit entry files and caller resolvers;
- `watch`: native-event acceleration backed by authoritative snapshots;
- `loop`: generic debounce, cause merge, serialization, and close behavior.

The corpus deliberately contains no Next.js, WordPress, Gutenberg, route,
plugin, development-service, or last-good-output term.
