import * as React from "react";
import type { JSX } from "react";

export type ButtonProps = {
  label: string;
};

export function Button(props: ButtonProps): JSX.Element {
  return <button>{props.label}</button>;
}
