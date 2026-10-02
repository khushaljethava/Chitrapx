import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/migrations/**", "**/next-env.d.ts", "supabase/**"] },
  ...tseslint.configs.recommended,
);
