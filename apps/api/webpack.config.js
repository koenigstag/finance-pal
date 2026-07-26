const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // externalDependencies: 'all' (the default) relies on webpack-node-externals scanning
  // {workspaceRoot}/node_modules with readdirSync — under pnpm that directory only lists the
  // root's own direct deps, not nested ones like typeorm, so it silently falls through to
  // bundling it. Bundled TypeORM breaks: PlatformTools.load() requires optional drivers (pg,
  // mysql2, ...) via a fully dynamic require(name) with no static prefix, which webpack can't
  // resolve into a real module and replaces with an always-throwing empty context. Declaring
  // them here (kept external regardless of the 'all' scan) avoids webpack ever parsing that
  // code — Node loads it for real, the same as everything else already excluded by 'all'.
  // Must stay an array, not a bare object: mergeExternals below only spreads config.externals
  // into its own externals list when Array.isArray(config.externals) is true. The explicit
  // "commonjs" prefix is required too — bare string externals (e.g. 'typeorm') default to the
  // "var" type without an explicit externalsType, compiling to a global-variable reference
  // instead of require('typeorm').
  // argon2 is a native addon (.node binary) — webpack can't bundle it under any
  // configuration, same treatment as typeorm/pg above.
  externals: [{ typeorm: 'commonjs typeorm', pg: 'commonjs pg', argon2: 'commonjs argon2' }],
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
      mergeExternals: true,
    }),
  ],
};
