import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...nx.configs['flat/react'],
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    // Override or add rules here
    rules: {},
  },
  {
    // The app's own half of the service worker, copied to the site root and imported by the one
    // Workbox generates. It runs in a worker, where `self` is the global — the rule that reads a
    // bare `self` as a mistaken `window` is about pages, and there is no window here.
    files: ['public/*.js'],
    rules: { 'no-restricted-globals': 'off' },
  },
];
