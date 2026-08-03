import type {JSX} from "react";

export default function Child(): JSX.Element {
  return <span>child</span>;
}

export function NamedChild(): JSX.Element {
  return <i>named</i>;
}
