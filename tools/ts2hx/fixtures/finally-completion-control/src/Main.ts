const events: string[] = [];
let localIndex = 0;
let localSteps = 0;

function advanceLocalLoop(): void {
  localSteps += 1;
  localIndex += 1;
}

// The loop belongs to the outer protected callback. Inner break/continue must
// stop here so "local:after-loop" still runs before the outer finalizer.
function localTarget(): void {
  try {
    for (localIndex = 0; localIndex < 2; advanceLocalLoop()) {
      try {
        events.push(`local:body:${localIndex}`);
        if (localIndex === 0) continue;
        break;
      } finally {
        events.push(`local:inner:${localIndex}`);
      }
    }
    events.push("local:after-loop");
  } finally {
    events.push("local:outer");
  }
  events.push(`local:steps:${localSteps}`);
}

// Here the loop surrounds both finalizers. The same transfer kinds must travel
// through both helpers before becoming a real break/continue at the loop.
function outerTarget(): void {
  for (let index = 0; index < 2; index++) {
    try {
      try {
        events.push(`outer:body:${index}`);
        if (index === 0) continue;
        break;
      } finally {
        events.push(`outer:inner:${index}`);
      }
    } finally {
      events.push(`outer:finally:${index}`);
    }
  }
  events.push("outer:after-loop");
}

function switchTargets(): void {
  const __ts2hx_break_target = "source-break";
  const __ts2hx_continue_target = "source-continue";
  events.push(`switch:names:${__ts2hx_break_target}:${__ts2hx_continue_target}`);
  switch (1) {
    case 1:
      try {
        events.push("switch:break-body");
        break;
      } finally {
        events.push("switch:break-finally");
      }
    default:
      events.push("switch:unreachable");
      break;
  }
  events.push("switch:after-break");

  for (let index = 0; index < 2; index++) {
    switch (index) {
      case 0:
        try {
          events.push("switch:continue-body");
          continue;
        } finally {
          events.push("switch:continue-finally");
        }
      default:
        events.push("switch:second");
        break;
    }
    events.push(`switch:after:${index}`);
  }
}

function controlOverridesThrow(): void {
  let index = 0;
  while (index < 2) {
    index += 1;
    try {
      events.push(`throw:body:${index}`);
      throw new Error(`protected:${index}`);
    } finally {
      events.push(`throw:finally:${index}`);
      if (index === 1) continue;
      break;
    }
  }
  events.push("throw:after-loop");
}

export function main(): void {
  localTarget();
  outerTarget();
  switchTargets();
  controlOverridesThrow();

  const actual = events.join("|");
  const expected = [
    "local:body:0",
    "local:inner:0",
    "local:body:1",
    "local:inner:1",
    "local:after-loop",
    "local:outer",
    "local:steps:1",
    "outer:body:0",
    "outer:inner:0",
    "outer:finally:0",
    "outer:body:1",
    "outer:inner:1",
    "outer:finally:1",
    "outer:after-loop",
    "switch:names:source-break:source-continue",
    "switch:break-body",
    "switch:break-finally",
    "switch:after-break",
    "switch:continue-body",
    "switch:continue-finally",
    "switch:second",
    "switch:after:1",
    "throw:body:1",
    "throw:finally:1",
    "throw:body:2",
    "throw:finally:2",
    "throw:after-loop"
  ].join("|");
  if (actual !== expected) throw new Error(`Unexpected completion trace: ${actual}`);
  console.log(`FINALLY_CONTROL_OK:${actual}`);
}
