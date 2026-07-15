import {Greeter} from "./classic-src-gen/my/app/Greeter.js";

const greeter = new Greeter("TypeScript consumer");
const message: string = greeter.greet();

// @ts-expect-error classic declarations must keep the public class closed.
greeter.nonexistentMethod();
// @ts-expect-error greet returns a string, never an unsafe broad value.
const invalid: number = greeter.greet();

void message;
void invalid;
