const events: string[] = [];
type __Ts2hxFinallyAbrupt = string;

function nestedReturn(): number {
  const __ts2hx_completion0 = "source-local";
  events.push(__ts2hx_completion0);
  try {
    try {
      events.push("body");
      return 1;
    } finally {
      events.push("inner");
    }
  } finally {
    events.push("outer");
    return 2;
  }
}

function returnOverThrow(): number {
  try {
    throw new Error("protected");
  } finally {
    events.push("throw-finally");
    return 3;
  }
}

function bareReturn(): void {
  try {
    events.push("void-body");
    return;
  } finally {
    events.push("void-finally");
  }
}

export function main(): void {
  const nested = nestedReturn();
  const overridden = returnOverThrow();
  bareReturn();
  console.log(`FINALLY_RETURN_OK:${nested}:${overridden}:${events.join("|")}`);
}
