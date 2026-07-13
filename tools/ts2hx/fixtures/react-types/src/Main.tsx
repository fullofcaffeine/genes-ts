import type { MouseEvent, ReactElement } from "react";

type LinkNode = {
  label: string;
  href: string;
  children: LinkNode[] | null;
};

export function NestedLinks({
  items,
  disabled,
  onClick,
  ordered = true
}: {
  items: LinkNode[];
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  ordered?: boolean;
}): ReactElement {
  return (
    <>
      {items.map((item, index) => {
        const ListTag = ordered ? "ol" : "ul";
        return (
          <li key={index}>
            <a
              href={item.href}
              aria-disabled={disabled || undefined}
              onClick={disabled && typeof onClick === "function" ? onClick : undefined}
            >
              {item.label}
            </a>
            {item.children ? (
              <ListTag>
                <NestedLinks
                  items={item.children}
                  disabled={disabled}
                  onClick={disabled && typeof onClick === "function" ? onClick : undefined}
                  ordered={ordered}
                />
              </ListTag>
            ) : null}
          </li>
        );
      })}
    </>
  );
}

export function main(): void {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => event.preventDefault();
  const element = NestedLinks({
    items: [{ label: "Guide", href: "#guide", children: null }],
    disabled: true,
    onClick,
    ordered: false
  });
  console.log(element != null ? "REACT_TYPES_OK" : "REACT_TYPES_FAIL");
}
