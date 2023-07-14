const OFF = 0;
const WARN = 1;
const ERROR = 2;

/** @type {import('eslint/lib/shared/types').ConfigData & { parserOptions: import('@typescript-eslint/types').ParserOptions }} */
module.exports = {
  root: true,
  reportUnusedDisableDirectives: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['tsconfig.json', 'tsconfig.node.json'],
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
    // byte savings
    '@typescript-eslint/no-confusing-void-expression': OFF,
    '@typescript-eslint/no-non-null-assertion': WARN,
    // worse performance
    '@typescript-eslint/prefer-string-starts-ends-with': OFF,
    // worse performance
    '@typescript-eslint/prefer-for-of': OFF,
    // void return can be used for efficient code (if used safely!)
    'consistent-return': WARN,
    'default-param-last': WARN,
    'import/prefer-default-export': OFF,
    // useful for compact and memory efficient code... but be careful!
    'no-cond-assign': OFF,
    // more compact at the cost of being harder to read
    'no-multi-assign': OFF,
    // can be used for efficient code (if used safely!)
    'no-param-reassign': WARN,
    'no-plusplus': OFF,
    'no-restricted-syntax': OFF,
    // useful for compact and memory efficient code... but be careful!
    'no-return-assign': OFF,
    // used in synthetic event handler names
    'no-underscore-dangle': OFF,
    'prettier/prettier': WARN,
    // byte savings + faster
    'unicorn/explicit-length-check': OFF,
    'unicorn/filename-case': OFF,
    'unicorn/no-abusive-eslint-disable': WARN,
    'unicorn/no-array-callback-reference': OFF,
    // forEach is often faster (in Chrome and Firefox but not Safari)
    'unicorn/no-array-for-each': OFF,
    'unicorn/no-await-expression-member': OFF,
    'unicorn/no-null': OFF,
    'unicorn/prefer-add-event-listener': OFF,
    'unicorn/prefer-dom-node-append': OFF,
    'unicorn/prefer-module': WARN,
    // indexOf is faster (in Chrome)
    'unicorn/prefer-includes': OFF,
    // saves 3 bytes to use arrow function
    'unicorn/prefer-native-coercion-functions': OFF,
    // slower and worse browser support
    'unicorn/prefer-string-replace-all': OFF,
    'unicorn/prefer-top-level-await': WARN,
    'unicorn/prefer-query-selector': OFF,
    'unicorn/prevent-abbreviations': OFF,
    'unicorn/switch-case-braces': [ERROR, 'avoid'],
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
