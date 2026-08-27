"use strict";

const postcss = require("postcss");
const postcssModules = require("postcss-modules");

/** Runs the real pinned processor from inert CSS and fixed data-only options. */
exports.runGenesProcessor = async (input) => {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof input.css !== "string" ||
    typeof input.from !== "string"
  ) {
    throw new Error("invalid test PostCSS input");
  }
  let tokens = null;
  const result = await postcss([
    postcssModules({
      generateScopedName: "genes_test_[name]__[local]",
      getJSON(_filename, output) {
        tokens = output;
      },
    }),
  ]).process(input.css, { from: input.from });
  if (tokens === null) throw new Error("PostCSS did not report exports");
  return { css: result.css, tokens };
};
