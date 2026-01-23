declare module "react-dom/server" {
  export function renderToString(element: any): string;
  export function renderToStaticMarkup(element: any): string;
}

