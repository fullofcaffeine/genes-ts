declare const DomainHost: {
  make<Value extends string>(
    validValues: Value[],
    initial: Value,
  ): [Value, (value: Value) => void];
};
