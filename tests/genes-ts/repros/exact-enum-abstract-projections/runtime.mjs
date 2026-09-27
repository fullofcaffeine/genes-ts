let selected = null;

globalThis.DomainHost = {
  make(_validValues, initial) {
    return [initial, (next) => {
      selected = next;
    }];
  },
  broadBox() {
    return { value: "published" };
  },
  exactBox() {
    return { value: "published" };
  },
};

await import(process.argv[2] ?? "./out/classic/index.js");

if (selected !== "published") {
  throw new Error(`tuple replacement selected ${String(selected)}`);
}

console.log("exact-enum-abstract-projections-runtime-ok");
