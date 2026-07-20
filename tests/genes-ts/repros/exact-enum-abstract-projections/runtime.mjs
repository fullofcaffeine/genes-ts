let selected = null;

globalThis.DomainHost = {
  make(_validValues, initial) {
    return [initial, (next) => {
      selected = next;
    }];
  },
};

await import("./out/classic/index.js");

if (selected !== "published") {
  throw new Error(`classic tuple replacement selected ${String(selected)}`);
}

console.log("exact-enum-abstract-projections-classic-ok");
