import { LibraryApi } from "./out/library/index.js";
import { SignatureOnly } from "./out/library/library_profile/SignatureOnly.js";

const api = new LibraryApi();
const input = new SignatureOnly("Ada");
const output: SignatureOnly = api.roundTrip(input);
const first: string | null = api.first(["Grace"]);

// @ts-expect-error the generic result preserves its element type
const wrongResult: number = api.first(["Grace"]);
// @ts-expect-error private implementation details are not package API
api.implementationDetail();
// @ts-expect-error the public class surface remains closed
api.missingMethod();

void output;
void first;
void wrongResult;
