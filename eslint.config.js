import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/migrations/**", "**/next-env.d.ts", "supabase/**"] },
  ...tseslint.configs.recommended,
  {
    // Code ported from open-screenshot-generator keeps its original idioms so upstream fixes stay easy to apply.
    files: ["packages/document/src/artboard.ts", "packages/renderer/src/osg/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
);
