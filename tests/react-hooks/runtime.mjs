import {strictEqual} from "node:assert";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {Counter} from "./out/classic/react_hooks/Main.js";
import {BlockEdit} from "./out/classic/react_hooks/GutenbergBlock.js";
import * as privateComponents from "./out/classic/react_hooks/PrivateComponent.js";

strictEqual(Object.hasOwn(privateComponents, "PrivateNote"), false,
  "private Haxe components are not public ESM bindings");
strictEqual(
  renderToStaticMarkup(React.createElement(privateComponents.PublicNote, {title: "Hidden helper"})),
  "<article>Hidden helper</article>",
  "public parent renders its private component and hook state through React"
);

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
