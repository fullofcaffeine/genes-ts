import type {JSX, ReactNode} from "react";

const reads: string[] = [];

function Parent(props: {children: ReactNode}): JSX.Element {
  return <aside>{props.children}</aside>;
}

function Child(): JSX.Element {
  return <b>object</b>;
}

const components = {
  get Parent(): typeof Parent {
    reads.push("object-parent-read");
    return Parent;
  },
  get Child(): typeof Child {
    reads.push("object-child-read");
    return Child;
  }
};

export default components;

export function takeReads(): string[] {
  return reads.splice(0);
}
