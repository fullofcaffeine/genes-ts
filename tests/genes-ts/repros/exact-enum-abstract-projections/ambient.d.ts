declare const DomainHost: {
  make<Value extends string>(
    validValues: Value[],
    initial: Value,
  ): [Value, (value: Value) => void];
  broadBox(): BroadBox<"draft" | "published">;
};

declare class BroadBox<Value extends string> {
  readonly value: string;
}
