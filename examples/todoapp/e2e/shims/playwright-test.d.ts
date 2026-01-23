declare module "@playwright/test" {
  export type WaitForUrlOptions = { waitUntil?: string };
  export type GetByRoleOptions = { name?: string };

  export interface Locator {
    fill(value: string): Promise<void>;
    click(): Promise<void>;
    count(): Promise<number>;
    waitFor(): Promise<void>;
    nth(index: number): Locator;
    isChecked(): Promise<boolean>;
  }

  export interface Page {
    on(event: string, listener: (...args: any[]) => void): void;
    goto(url: string): Promise<any>;
    getByPlaceholder(text: string): Locator;
    getByRole(role: string, options?: GetByRoleOptions): Locator;
    getByText(text: string): Locator;
    waitForURL(url: string | RegExp, options?: WaitForUrlOptions): Promise<void>;
    url(): string;
    locator(selector: string): Locator;
  }

  export type TestArgs = { page: Page };
  export const test: (name: string, fn: (args: TestArgs) => Promise<void>) => void;
  export const expect: any;
  export function defineConfig(config: any): any;
}
