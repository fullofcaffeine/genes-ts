import {useState} from "react";

/** Deliberately invalid native control proving the official lint is active. */
export function BrokenComponent({enabled}) {
  if (enabled) {
    useState(0);
  }
  return null;
}
