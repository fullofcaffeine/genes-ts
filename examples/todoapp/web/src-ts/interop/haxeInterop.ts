/**
 * The Todo app has two generated module trees: `src-gen` for TypeScript output
 * and `classic-src-gen` for direct JavaScript output. Importing either folder
 * here would make this shared adapter depend on whichever profile happened to
 * run first.
 *
 * Both build profiles therefore map this stable module name to their own
 * generated tree through the `tsconfig` passed to TypeScript and esbuild. The
 * imported value is still the real Haxe-emitted `TodoText` class; only its
 * build-specific filesystem location is selected outside authored source.
 */
import { TodoText } from "@todoapp/generated/todo/shared/TodoText";

export function interopBanner(): string {
  return TodoText.interopBanner();
}
