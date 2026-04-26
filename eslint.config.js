import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  {
    // Global rules applied to all TypeScript files in packages/
    rules: {
      // Respect underscore prefix as "intentionally unused" for both vars and params.
      // This overrides the recommended preset's stricter default.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Enable no-fallthrough so existing eslint-disable-next-line directives in
      // actions.ts remain meaningful (they suppress intentional switch fallthroughs).
      "no-fallthrough": "error",
    },
  },
  {
    // Core-only restriction: no Node.js built-in imports.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "Core must not import Node built-ins. Move Node-specific code to packages/cli.",
            },
            {
              group: [
                "fs",
                "path",
                "os",
                "readline",
                "child_process",
                "stream",
              ],
              message:
                "Core must not import Node built-ins. Use the bare 'node:' specifier in cli code.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/dungeon.generated.ts"],
  },
];
