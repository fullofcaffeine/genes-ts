import React from "react";

export type ButtonProps = {
  label: string;
};

export default function Button(props: ButtonProps) {
  return React.createElement("button", null, props.label);
}

