import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {jsx: true}
      }
    },
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      "react-hooks/rules-of-hooks": "error"
    }
  },
  {
    files: ["**/StateProjectionCases.{js,jsx}"],
    plugins: {
      "react-hooks": reactHooks
    },
    rules: {
      "react-hooks/exhaustive-deps": "error"
    }
  }
];
