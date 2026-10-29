import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Error: una promesa sin manejar puede rechazar sin que nadie lo vea.
      '@typescript-eslint/no-floating-promises': 'error',
      // Advertencias por ahora: el código existente las incumple y corregirlas amplía el alcance de esta configuración inicial.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'no-control-regex': 'warn',
    },
  },
  {
    // Los tests e2e no están en tsconfig.json: se lintan con tsconfig.eslint.json, que sí los incluye.
    files: ['test/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: false, project: './tsconfig.eslint.json' },
    },
  },
  {
    // TypeScript resuelve los identificadores globales; `no-undef` daría falsos positivos (describe, it, etc.).
    files: ['**/*.ts'],
    rules: { 'no-undef': 'off' },
  },
);
