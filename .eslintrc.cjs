const OFF = 0;
const WARN = 1;
const ERROR = 2;

/** @type {import('eslint/lib/shared/types').ConfigData & { parserOptions: import('@typescript-eslint/types').ParserOptions }} */
module.exports = {
  root: true,
  reportUnusedDisableDirectives: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['tsconfig.json', 'tsconfig.node.json', 'bench/tsconfig.json'],
    tsconfigRootDir: __dirname,
  },
  extends: [
    'eslint:recommended',
    'airbnb-base',
    'airbnb-typescript/base',
    'plugin:@typescript-eslint/strict-type-checked',
    'plugin:@typescript-eslint/stylistic-type-checked',
    'plugin:unicorn/recommended',
    'prettier',
  ],
  plugins: ['prettier'],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': ERROR,
    '@typescript-eslint/no-non-null-assertion': WARN,
    'import/prefer-default-export': OFF,
    'import/order': OFF, // broken with prettier
    'no-restricted-syntax': OFF,
    'prettier/prettier': WARN,
    'unicorn/filename-case': OFF,
    'unicorn/no-abusive-eslint-disable': WARN,
    'unicorn/no-null': OFF,
    'unicorn/prefer-module': WARN,
    'unicorn/prefer-top-level-await': WARN,
    'unicorn/prevent-abbreviations': OFF,

    /* Performance and byte savings */
    // byte savings
    '@typescript-eslint/no-confusing-void-expression': OFF,
    // worse performance
    '@typescript-eslint/prefer-includes': OFF,
    // worse performance
    '@typescript-eslint/prefer-for-of': OFF,
    // worse performance
    '@typescript-eslint/prefer-string-starts-ends-with': OFF,
    // void return can be used for efficient code (if used safely!)
    'consistent-return': WARN,
    // useful for compact and memory efficient code... but be careful!
    'no-cond-assign': OFF,
    // more compact at the cost of being harder to read
    'no-multi-assign': OFF,
    // can be used for efficient code (if used safely!)
    'no-param-reassign': WARN,
    'no-plusplus': OFF,
    // useful for compact and memory efficient code... but be careful!
    'no-return-assign': OFF,
    // byte savings + faster
    'unicorn/explicit-length-check': OFF,
    'unicorn/no-array-callback-reference': OFF,
    // forEach is often faster (in Chrome and Firefox but not Safari)
    'unicorn/no-array-for-each': OFF,
    'unicorn/no-await-expression-member': OFF,
    // indexOf is faster (in Chrome)
    'unicorn/prefer-includes': OFF,
    // saves 3 bytes to use arrow function
    'unicorn/prefer-native-coercion-functions': OFF,
    // slower and worse browser support
    'unicorn/prefer-string-replace-all': OFF,
    'unicorn/switch-case-braces': [ERROR, 'avoid'],

    /* stage1 */
    '@typescript-eslint/consistent-type-definitions': OFF, // FIXME: Issue with stage1 collect Refs
    // underscores in synthetic event handler names
    'no-underscore-dangle': OFF,
    'unicorn/prefer-add-event-listener': OFF,
    'unicorn/prefer-dom-node-append': OFF,
    'unicorn/prefer-query-selector': OFF,
  },
  overrides: [
    {
      files: ['*.spec.ts', '*.test.ts', 'build.ts', '*.config.ts', '*.d.ts'],
      rules: {
        'import/no-extraneous-dependencies': OFF,
      },
    },
  ],
};
