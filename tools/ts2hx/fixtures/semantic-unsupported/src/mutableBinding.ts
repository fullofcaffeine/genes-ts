import { value } from "./mutableSource.js";

/** Reading a mutable imported binding requires live-view semantics. */
export const observed = value;
