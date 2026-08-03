import type {JSX, ReactNode} from "react";

const reads: string[] = [];

function Parent(props: {children: ReactNode}): JSX.Element {
  return <article>{props.children}</article>;
}

function Child(): JSX.Element {
  return <em>dotted</em>;
}

export const Components = {
  get Parent(): typeof Parent {
    reads.push("dotted-parent-read");
    return Parent;
  },
  get Child(): typeof Child {
    reads.push("dotted-child-read");
    return Child;
  }
};

export function takeReads(): string[] {
  return reads.splice(0);
}
