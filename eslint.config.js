import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/migrations/**", "**/next-env.d.ts", "supabase/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/src/**/*.tsx", "apps/web/src/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    // Code ported from open-screenshot-generator keeps its upstream shape so upstream fixes stay easy to apply.
    // Last so it wins over the rules above.
    files: ["packages/document/src/artboard.ts", "packages/renderer/src/osg/**"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-vars": "off", "prefer-const": "off" },
  },
);
