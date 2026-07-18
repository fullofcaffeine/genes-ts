declare module "react" {
  /**
   * This small test-only surface models both ways the fixture imports React.
   * A namespace import reads the named `createElement` export, while the
   * `@:native("React.Component")` compatibility case reads `Component` from
   * the default object. Keeping both shapes explicit prevents an import bug
   * from hiding behind one broad `any` default declaration. Attribute and child
   * values remain `unknown` because this ambient host boundary only passes them
   * through; the fixture never inspects them or claims a more specific schema.
   */
  export type ReactNode = Readonly<Record<string, never>>;
  export interface ComponentConstructor {
    new (...arguments_: never[]): object;
  }
  export function createElement(
    type: ComponentConstructor,
    attributes?: Readonly<Record<string, unknown>>,
    ...children: ReadonlyArray<unknown>
  ): ReactNode;
  export class Component<Props = Readonly<Record<string, never>>, State = Readonly<Record<string, never>>> {}
  export const Fragment: Readonly<Record<string, never>>;

  const React: {
    readonly createElement: typeof createElement;
    readonly Component: typeof Component;
    readonly Fragment: typeof Fragment;
  };
  export default React;
}
