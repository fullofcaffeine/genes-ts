declare module "@playwright/test" {
  export type Response = import("playwright").Response;
  export type ConsoleMessage = import("playwright").ConsoleMessage;

  export type WaitForUrlOptions = { waitUntil?: string };
  export type GetByRoleOptions = { name?: string };

  export interface Locator {
    fill(value: string): Promise<void>;
    click(): Promise<void>;
    check(): Promise<void>;
    count(): Promise<number>;
    waitFor(): Promise<void>;
    nth(index: number): Locator;
    isChecked(): Promise<boolean>;
    inputValue(): Promise<string>;
  }

  export interface Page {
    on(event: "pageerror", listener: (err: Error) => void): void;
    on(event: "console", listener: (msg: ConsoleMessage) => void): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    goto(url: string): Promise<Response | null>;
    getByPlaceholder(text: string): Locator;
    getByRole(role: string, options?: GetByRoleOptions): Locator;
    getByText(text: string): Locator;
    waitForURL(url: string | RegExp, options?: WaitForUrlOptions): Promise<void>;
    url(): string;
    locator(selector: string): Locator;
  }

  export type TestArgs = { page: Page };
  export const test: (name: string, fn: (args: TestArgs) => Promise<void>) => void;
  export const expect: unknown;
  export function defineConfig(config: unknown): unknown;
}
