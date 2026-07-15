package tests.webidl;

/**
 * Public fixture that keeps Haxe's historical WebIDL names declaration-live.
 *
 * Why:
 * Haxe 4.3.7 models geolocation failures as `PositionError` and fetch progress
 * callbacks with `FetchObserver`; TypeScript's DOM library omits both names.
 *
 * What:
 * The fields force classic declaration generation to retain the relevant DOM
 * extern modules and expose their unresolved host types to a strict consumer.
 *
 * How:
 * The Node runtime fixture returns no browser value, while the emitted `.d.ts`
 * retains the non-null public host contracts below for static validation.
 */
typedef WebIdlGapSurface = {
  final geolocation: js.html.Geolocation;
  final observer: js.html.ObserverCallback;
}
