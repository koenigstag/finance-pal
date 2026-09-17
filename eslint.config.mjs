import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Scope: backend and frontend may both use shared code, never each other.
            {
              sourceTag: 'scope:api',
              onlyDependOnLibsWithTags: ['scope:api', 'scope:shared'],
            },
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            // Shared code ships to the browser, so it must stay runtime-neutral.
            // This is what keeps Nest, TypeORM and argon2 out of the PWA bundle.
            {
              sourceTag: 'platform:agnostic',
              bannedExternalImports: [
                '@nestjs/*',
                'typeorm',
                'typeorm-transactional',
                'argon2',
                'react',
                'react-*',
              ],
            },
            // Browser code must never pull in server-only packages. scope:web already keeps it
            // off @ft/api-* libs; this catches the same packages imported from npm directly.
            // socket.io (the server) is banned, socket.io-client is what the browser uses.
            {
              sourceTag: 'platform:browser',
              bannedExternalImports: [
                '@nestjs/*',
                'typeorm',
                'typeorm-transactional',
                'argon2',
                'pg',
                'socket.io',
              ],
            },
            // Contracts are the lowest layer: they may not depend on features.
            {
              sourceTag: 'type:contracts',
              onlyDependOnLibsWithTags: ['type:contracts', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:contracts',
                'type:util',
                'type:ui',
              ],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
