export default class ExternClass {
  test: number;
  constructor(num: number);
}

export class ExtendHaxeClass {
  random: number;
  constructor();
  test(): string;
}

export class Dropdown {
  constructor();
}

export namespace Dropdown {
  class Header {
    test: number;
    constructor(num: number);
  }

  class Menu {
    test: number;
    constructor(num: number);
  }
}

export class MyClass {
  constructor();
  toString(): string;
}
