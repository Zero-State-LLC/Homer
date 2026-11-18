import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// `typescript` resolves to the TypeScript 6 API (`@typescript/typescript6`)
// because typescript-eslint cannot load TypeScript 7 yet. `tsc` is TypeScript 7
// via the `@typescript/native` alias.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [eslint.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
