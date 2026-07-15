import assert from "node:assert/strict";
import { LibraryApi } from "./out/typescript/dist/index.js";
import { SignatureOnly } from "./out/typescript/dist/library_profile/SignatureOnly.js";

const api = new LibraryApi();
const input = new SignatureOnly("Ada");
assert.equal(api.roundTrip(input), input);
assert.equal(input.upper(), "ADA");
assert.equal(api.first(["Grace"]), "Grace");
assert.equal(api.first([]), null);

console.log("library-profile:typescript-runtime-ok");
