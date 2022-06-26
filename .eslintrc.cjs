const OFF = 0;
const WARN = 1;
const ERROR = 2;

// TODO: Types
// eslint-disable-next-line max-len
// /** @type {import('eslint/lib/shared/types').ConfigData & { parserOptions: import('@typescript-eslint/types').ParserOptions }} */
module.exports = {
  root: true,
  reportUnusedDisableDirectives: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    extraFileExtensions: ['.mjs', '.cjs'],
    project: ['./test/tsconfig.json'],
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  rules: {
    // TODO: Fix issues then remove this rule
    '@typescript-eslint/naming-convention': WARN,

    '@typescript-eslint/explicit-module-boundary-types': ERROR,
    'default-param-last': WARN,
    'import/prefer-default-export': OFF,
    // void return can be used for efficient code (if used safely!)
    'consistent-return': WARN,
    // useful for compact and memory efficient code... but be careful!
    'no-cond-assign': OFF,
    // can be used for efficient code (if used safely!)
    'no-param-reassign': WARN,
    'no-plusplus': OFF,
    'no-restricted-syntax': OFF,
    // useful for compact and memory efficient code... but be careful!
    'no-return-assign': OFF,
    // used in synthetic event handler names
    'no-underscore-dangle': OFF,
  },
};
