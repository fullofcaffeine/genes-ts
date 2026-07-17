import {Main} from "./out/ts/src-gen/template_literals/Main.js";

const href: `/records/${string}` = Main.href("typed");
const staticHref: "/about" = Main.staticHref();

// Ordinary Haxe interpolation emits `+` and TypeScript widens it to `string`.
// @ts-expect-error TemplateLiteral.value is required to retain this shape.
const widened: `/records/${string}` = Main.ordinaryInterpolation("widened");

// The retained shape is still specific and rejects an unrelated path family.
// @ts-expect-error Main.href emits only the /records template family.
const wrongFamily: `/users/${string}` = Main.href("wrong");

void href;
void staticHref;
void widened;
void wrongFamily;
