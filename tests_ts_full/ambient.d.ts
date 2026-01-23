type param2 = any;

declare namespace NodeJS {
  interface Global {
    a: any;
  }
}

declare module "react" {
  const React: any;
  export default React;
}

declare module "react-dom/server.js" {
  const ReactDOMServer: any;
  export default ReactDOMServer;
}
