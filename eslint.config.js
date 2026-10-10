// @ts-check
import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // Raw `pg` rows are typed per repository; `any` stays visible, not banned.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      // `const { secret: _s, ...safe } = row` is the idiom for dropping fields.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["error", "log"] }],
    },
  },
  {
    // Controllers must not touch the database directly.
    files: ["src/modules/**/*.controller.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/database/*", "**/*.repository.js"],
              message: "Controllers call services; services call repositories.",
            },
          ],
        },
      ],
    },
  },
);
