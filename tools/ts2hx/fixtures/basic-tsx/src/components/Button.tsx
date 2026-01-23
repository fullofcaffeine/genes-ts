import * as React from "react";

export type ButtonProps = {
  label: string;
};

export function Button(props: ButtonProps): JSX.Element {
  return <button>{props.label}</button>;
}

