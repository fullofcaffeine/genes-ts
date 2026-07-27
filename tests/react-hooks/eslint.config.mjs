import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["**/*.js"],
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      "react-hooks/rules-of-hooks": "error"
    }
  }
];
