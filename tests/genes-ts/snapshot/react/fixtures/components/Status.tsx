import React from "react";

export type StatusProps = {
  label: string;
  value: string;
  children?: React.ReactNode;
};

export default function Status(props: StatusProps) {
  return React.createElement(
    "section",
    { "data-label": props.label },
    React.createElement("strong", null, props.value),
    props.children
  );
}
