import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// Synchronization and locator rules for all code (AGENTS.md, docs/ai/test-quality-gates.md).
// ESLint replaces a rule's options per file block instead of merging them, so the blocks below
// repeat this list before adding their own restrictions.
const syncAndLocatorRules = [
  {
    selector: "CallExpression[callee.property.name='waitForTimeout']",
    message: 'Synchronize on observable application state instead of sleeping.',
  },
  {
    selector: "CallExpression[callee.property.name='pause']",
    message: 'Remove debugging pauses before committing.',
  },
  {
    selector: "Literal[value='networkidle']",
    message:
      'Wait for the specific response or rendered answer the action causes, not network idle.',
  },
  {
    // Only in the options of a Playwright action (fs.rmSync's `force` is unrelated).
    selector:
      "CallExpression[callee.property.name=/^(click|dblclick|tap|hover|fill|clear|press|check|uncheck|setChecked|selectOption|selectText|dragTo)$/] > ObjectExpression.arguments > Property[key.name='force'][value.value=true]",
    message: 'force: true skips actionability checks and hides real UI problems.',
  },
  {
    selector:
      "CallExpression[callee.property.name='locator'] > :matches(Literal.arguments[value=/^(xpath=|\\u002F|\\(\\u002F)/], TemplateLiteral.arguments[quasis.0.value.raw=/^(xpath=|\\u002F|\\(\\u002F)/])",
    message: 'No XPath: use getByRole/getByText or a stable id/name attribute (AGENTS.md).',
  },
];
// Behavior is defined in Gherkin only; playwright/cucumber.spec.ts is the single adapter.
const noPlaywrightTest = {
  name: '@playwright/test',
  importNames: ['test'],
  message:
    'Write a Gherkin scenario; Playwright test() blocks are not used for behavior (AGENTS.md).',
};

export default tseslint.config(
  { ignores: ['node_modules/', 'reports/', 'build/', 'deployment/', 'cucumber.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A missing `await` on a Playwright call is a classic source of false positives.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-restricted-syntax': ['error', ...syncAndLocatorRules],
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [noPlaywrightTest] }] },
  },
  {
    // Steps coordinate; selectors live in Page Objects and data in src/factories.
    files: ['src/step-definitions/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...syncAndLocatorRules,
        {
          selector:
            "CallExpression:matches([callee.object.name='page'], [callee.object.property.name='page'])[callee.property.name=/^(locator|getBy[A-Za-z]+)$/]",
          message: 'Selectors belong in a Page Object (src/pages), not in a step definition.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Generate data in src/factories (test-data.ts allocator), not in steps.',
        },
      ],
    },
  },
  {
    // Page Objects expose locators and actions; the steps own the assertions.
    files: ['src/pages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            noPlaywrightTest,
            {
              name: '@playwright/test',
              importNames: ['expect'],
              message: 'Page Objects contain no assertions; assert in the step definition.',
            },
          ],
          patterns: [
            {
              group: ['**/support/assertions', '**/support/ledger-assertions'],
              message: 'Page Objects contain no assertions; assert in the step definition.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...syncAndLocatorRules,
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Generate data in src/factories (test-data.ts allocator), not in Page Objects.',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // node:test registers suites with describe()/it(), which return promises the runner awaits.
    files: ['scripts/ci/tests/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  { files: ['**/*.mjs'], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);
