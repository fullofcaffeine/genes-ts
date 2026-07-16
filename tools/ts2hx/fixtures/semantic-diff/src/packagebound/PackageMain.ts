import greet, { add as sum, enabled, label, notify } from "@ts2hx/typed-package";
import * as TypedPackage from "@ts2hx/typed-package";
import { add as duplicateAdd } from "@ts2hx/typed-package";
import { unused } from "@ts2hx/typed-package";

export function main(): void {
  notify("called");
  const values = [
    greet("world"),
    `${sum(1, 2)}`,
    `${TypedPackage.add(3, 4)}`,
    `${duplicateAdd(5, 6)}`,
    `${TypedPackage.PI}`,
    label,
    `${enabled}`
  ];
  console.log(`PACKAGE_TRACE:${values.join("|")}`);
}
