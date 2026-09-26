package module_functions;

/** A public entrypoint may call a selected helper without exporting it. */
@:genes.moduleFunction("publicIdentity")
function publicIdentity<T>(value: T): T {
  return privateIdentity(value);
}

@:genes.moduleFunction("privateIdentity")
private function privateIdentity<T>(value: T): T {
  return value;
}
