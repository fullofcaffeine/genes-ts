import "@ts2hx/semantic-effect";
import { moduleLabel, moduleValue } from "./support.js";
import "./runtime/after-support.mjs";
import "./runtime/config.json" with { type: "json" };

const events: string[] = [];

function withDefault(value: string | null = "fallback"): string {
  if (value === null) return "null";
  return value;
}

function truthyString(value: string | null): string {
  if (value) return "truthy";
  return "falsy";
}

function truthyNumber(value: number): string {
  if (value) return "truthy";
  return "falsy";
}

function numericString(value: string): number {
  return +value;
}

let coercionReads = 0;

function nextNumericString(value: string): string {
  coercionReads += 1;
  return value;
}

function nullableObject(value: { name: string } | null): string {
  return value ? value.name : "missing";
}

const box: { value: number } = { value: 1 };

function getBox(): { value: number } {
  events.push("assign:receiver");
  return box;
}

function assignmentRhs(): number {
  events.push("assign:rhs");
  return 2;
}

function mixedSwitchValue(): string | number {
  return "1";
}

function switchCase(value: number): number {
  events.push(`switch:case:${value}`);
  return value;
}

function whileSwitchContinue(): string {
  const seen: string[] = [];
  let index = 0;
  while (index < 4) {
    index += 1;
    switch (index) {
      case 1:
        seen.push("direct:1");
        continue;
      case 2:
        if (index === 2) {
          seen.push("conditional:2");
          continue;
        }
        seen.push("unreachable");
        break;
      case 3:
        seen.push("fallthrough:3");
      default:
        seen.push(`case-end:${index}`);
        break;
    }
    seen.push(`body:${index}`);
  }
  return seen.join(",");
}

let switchForSteps = 0;
let switchForIndex = 0;

function advanceSwitchFor(): void {
  switchForSteps += 1;
  switchForIndex += 1;
}

function forSwitchContinue(): string {
  const seen: string[] = [];
  switchForSteps = 0;
  for (switchForIndex = 0; switchForIndex < 4; advanceSwitchFor()) {
    switch (switchForIndex) {
      case 0:
        seen.push("continue:0");
        continue;
      case 2:
        if (switchForIndex === 2) continue;
        break;
      default:
        break;
    }
    seen.push(`body:${switchForIndex}`);
  }
  return `${seen.join(",")}|steps:${switchForSteps}`;
}

function nestedLoopSwitchContinue(): string {
  const seen: string[] = [];
  let outer = 0;
  while (outer < 2) {
    outer += 1;
    switch (outer) {
      case 1:
        for (let inner = 0; inner < 3; inner++) {
          if (inner === 1) continue;
          seen.push(`inner:${inner}`);
        }
        seen.push("nested-done");
        break;
      case 2:
        seen.push("outer-continue");
        continue;
    }
    seen.push(`outer-body:${outer}`);
  }
  return seen.join(",");
}

function nestedSwitchContinue(): string {
  const seen: string[] = [];
  let index = 0;
  while (index < 3) {
    index += 1;
    switch (index) {
      case 1:
        switch (index) {
          case 1:
            seen.push("inner-continue");
            continue;
          default:
            break;
        }
        seen.push("unreachable");
        break;
      case 2:
        seen.push("outer:2");
        break;
      default:
        seen.push(`outer:${index}`);
        break;
    }
    seen.push(`body:${index}`);
  }
  return seen.join(",");
}

// Keeps source-function ownership observable. The inner switch continue must
// use the inner for-loop increment, while leaving the outer loop state intact.
function nestedFunctionControlState(): string {
  const seen: string[] = [];
  for (let outer = 0; outer < 2; outer++) {
    const collectInner = (): string => {
      const innerSeen: string[] = [];
      for (let inner = 0; inner < 3; inner++) {
        switch (inner) {
          case 1:
            continue;
          default:
            innerSeen.push(`${outer}:${inner}`);
            break;
        }
      }
      return innerSeen.join(",");
    };
    seen.push(collectInner());
  }
  return seen.join("|");
}

class Counter {
  private value: number;

  public constructor(value: number) {
    this.value = value;
  }

  public bump(delta: number): number {
    this.value += delta;
    return this.value;
  }

  public incrementer(): () => number {
    return (): number => {
      this.value += 1;
      return this.value;
    };
  }
}

async function asyncStep(): Promise<number> {
  events.push("async:start");
  await Promise.resolve(0);
  events.push("async:resumed");
  return 1;
}

export function main(): void {
  events.push(`module:${moduleLabel}:${moduleValue(1)}`);
  events.push(`default:omitted:${withDefault()}`);
  events.push(`default:undefined:${withDefault(undefined)}`);
  events.push(`default:null:${withDefault(null)}`);

  let uninitialized: string | undefined;
  events.push(`uninitialized:${typeof uninitialized}`);
  uninitialized = "set";
  events.push(`initialized:${uninitialized}`);

  events.push(`truthy:string-empty:${truthyString("")}`);
  events.push(`truthy:string-value:${truthyString("x")}`);
  events.push(`truthy:number-zero:${truthyNumber(0)}`);
  events.push(`truthy:number-one:${truthyNumber(1)}`);
  events.push(`truthy:object:${nullableObject({ name: "present" })}`);
  events.push(`truthy:object-null:${nullableObject(null)}`);

  events.push(`unary-plus:numeric:${numericString("42.5")}`);
  events.push(`unary-plus:empty:${numericString("")}`);
  events.push(`unary-plus:whitespace:${numericString("  ")}`);
  events.push(`unary-plus:invalid:${numericString("not-a-number")}`);
  events.push(`unary-plus:signed:${numericString("-7.25")}`);
  events.push(`unary-plus:once:${+nextNumericString("3")}:${coercionReads}`);

  const assignmentResult = getBox().value += assignmentRhs();
  events.push(`assign:result:${assignmentResult}:${box.value}`);

  for (let i = 0; i < 4; i++) {
    if (i === 1) continue;
    events.push(`loop:${i}`);
  }

  events.push(`switch-continue:while:${whileSwitchContinue()}`);
  events.push(`switch-continue:for:${forSwitchContinue()}`);
  events.push(`switch-continue:nested-loop:${nestedLoopSwitchContinue()}`);
  events.push(`switch-continue:nested-switch:${nestedSwitchContinue()}`);
  events.push(`function-state:${nestedFunctionControlState()}`);

  const firstSwitch: number = 2;
  switch (firstSwitch) {
    case switchCase(1):
      events.push("switch:one");
      break;
    case switchCase(2):
      events.push("switch:two");
    case switchCase(3):
      events.push("switch:three");
      break;
    default:
      events.push("switch:default");
  }

  const secondSwitch: number = 9;
  switch (secondSwitch) {
    case 1:
      events.push("switch2:one");
      break;
    default:
      events.push("switch2:default");
    case 10:
      events.push("switch2:ten");
      break;
  }

  switch (mixedSwitchValue()) {
    case 1:
      events.push("switch3:coerced");
      break;
    case "1":
      events.push("switch3:strict");
      break;
  }

  try {
    events.push("exception:try");
    throw new Error("expected");
  } catch {
    events.push("exception:catch");
  } finally {
    events.push("exception:finally");
  }

  const counter = new Counter(1);
  events.push(`this:method:${counter.bump(2)}`);
  const increment = counter.incrementer();
  events.push(`this:arrow:${increment()}`);

  asyncStep().then((_value: number): number => {
    events.push("async:then");
    console.log(`SEMANTIC_TRACE:${JSON.stringify(events)}`);
    return 0;
  });
}
