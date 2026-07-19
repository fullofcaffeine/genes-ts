import genes.react.Element;

/** Proves a project-supplied tag and prefixed attribute compile in classic JS. */
class CustomProviderMain {
  static function main(): Void {
    final card = <x-card tone="warm" qa-id={7}>Typed custom tag</x-card>;
  }
}
