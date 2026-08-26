import {strictEqual} from "node:assert";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {Counter} from "./out/classic/react_hooks/Main.js";
import {BlockEdit} from "./out/classic/react_hooks/GutenbergBlock.js";

strictEqual(
  renderToStaticMarkup(React.createElement(Counter, {initial: 3})),
  "<button> Count 3</button>",
  "projected component state renders through React"
);
strictEqual(
  renderToStaticMarkup(React.createElement(BlockEdit, {
    attributes: {title: "Projection"}
  })),
  '<button aria-pressed="false">Projection</button>',
  "projected Gutenberg-shaped state renders through React"
);

console.log("React state projection runtime evidence passed");
