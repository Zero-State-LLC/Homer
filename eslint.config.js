import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

// TypeScript is held at 6.0.x: typescript-eslint 8.73 supports `typescript <6.1`.
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
