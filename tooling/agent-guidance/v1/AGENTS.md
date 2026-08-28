<!-- BEGIN @genes-ts/tooling:agent-guidance -->
<!-- genes-agent-guidance-version: 1 -->
## Genes development workflow

This project uses Genes to generate TypeScript or JavaScript from typed Haxe.
Use the project commands and settings that the repository documents.

### Keep these owners separate

- Haxe and Genes read authored Haxe and create one complete candidate tree.
- Genes tooling serializes builds and protects the last accepted public tree.
- The host validates candidates and owns framework commands, diagnostics, and server behavior.

Do not make generated files the source of truth. Do not repair a failed build
by editing a candidate or the public generated tree.

### Use this safe development loop

1. Edit authored Haxe, configuration, or other declared inputs.
2. Wait for a structured Genes event that identifies the observed revision.
3. Use `inspect()` to read the current lifecycle state.
4. Use `firstAccepted` before you start a service that needs generated files.
5. Use `waitForIdle()` before tests or tools read the newest accepted generation.
6. Treat an accepted-generation event as the publication barrier.

A failed revision does not erase the last accepted generation. Fix the authored
input and wait for a later accepted generation. Do not infer success from a
delay, a log line, or the presence of one generated file.

### Verify production work

Run the repository's documented production build, validator, and test gates.
A development-session event is not a substitute for those gates. Record the
accepted generation, source revision, and manifest digest when automation needs
an exact handoff.

For the public API and event contract, read the
[Genes tooling guide](https://github.com/fullofcaffeine/genes-ts/blob/main/tooling/README.md)
and the
[DevelopmentSession v1 contract](https://github.com/fullofcaffeine/genes-ts/blob/main/tooling/development-session/v1/README.md).
<!-- END @genes-ts/tooling:agent-guidance -->
