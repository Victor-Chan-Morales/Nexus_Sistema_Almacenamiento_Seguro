import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // tsconfig.eslint.json incluye src y los tests e2e (que tsconfig.json no compila): un único programa para todo.
        project: './tsconfig.eslint.json',
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
    // TypeScript resuelve los identificadores globales; `no-undef` daría falsos positivos (describe, it, etc.).
    files: ['**/*.ts'],
    rules: { 'no-undef': 'off' },
  },
);
