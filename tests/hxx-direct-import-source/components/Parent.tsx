import type {JSX, ReactNode} from "react";

export default function Parent(props: {children: ReactNode}): JSX.Element {
  return <section>{props.children}</section>;
}

export function NamedParent(props: {children: ReactNode}): JSX.Element {
  return <nav>{props.children}</nav>;
}
