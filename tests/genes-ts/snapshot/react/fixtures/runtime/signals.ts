export type Accessor<T> = () => T;

export type Signal<T> = {
  get: Accessor<T>;
  set(value: T): void;
};

export function createSignal<T>(initial: T): Signal<T> {
  let current = initial;
  return {
    get() {
      return current;
    },
    set(value) {
      current = value;
    },
  };
}

export function createMemo<T>(fn: Accessor<T>): Accessor<T> {
  return fn;
}
