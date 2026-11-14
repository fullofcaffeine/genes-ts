/// <reference types="node" preserve="true" />

/** Native Haxe execution without shell fallback. The host owns child completion. */
export {
  HaxeLaunchError,
  inspectNativeExecutableFile,
  launchHaxe,
  runHaxeSync,
  type HaxeLaunch,
  type HaxeLaunchOptions,
  type HaxeSyncOptions,
} from "../session/haxe-launch.js";
