export interface Cell<Value> {
  value: Value;
  replace(value: Value): void;
  seal(): Cell<Value>;
}

export declare function makeCell<Value>(initial: Value): Cell<Value>;
export declare function makeCell<Value = undefined>(): Cell<Value>;

export declare function inferCell<Value>(initial: Value): Cell<Value>;

export interface Pair<Left, Right> {
  left: Left;
  right: Right;
}

export declare function makePair<Left, Right>(
  left: Left,
  right: Right
): Pair<Left, Right>;
