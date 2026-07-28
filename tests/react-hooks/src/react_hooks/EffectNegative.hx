package react_hooks;

import genes.react.React.deps;
import genes.react.React.useEffect;

class EffectNegative {
  @:genes.reactHook
  static function useInvalidEffect(): Void {
    useEffect(() -> 42, deps());
  }
}
