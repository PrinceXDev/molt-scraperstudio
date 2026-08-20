import type { NextConfig } from 'next';

/**
 * Workspace packages are consumed as TypeScript source, not prebuilt output —
 * `@molt/health`, `@molt/store` etc. export `./src/index.ts` directly (see each
 * package's `exports` map). Next.js only transpiles packages it is told to.
 */
const config: NextConfig = {
  transpilePackages: [
    '@molt/health',
    '@molt/brightdata',
    '@molt/diagnose',
    '@molt/store',
    '@molt/core',
  ],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  // libsql loads a native binary via a dynamic require() that webpack cannot
  // statically resolve, so it falls back to bundling the whole directory —
  // README, LICENSE and all — and chokes on the non-JS files. This only ever
  // runs server-side (same as the CLI's `bdata` spawn), so let Node's own
  // `require()` handle it at runtime instead of bundling it.
  serverExternalPackages: ['@libsql/client', 'libsql', '@brightdata/cli'],
  webpack: (cfg, { isServer }) => {
    // The workspace packages are NodeNext ESM: their source imports
    // `./envelopes.js` while the file on disk is `envelopes.ts` (the `.js`
    // extension is correct for Node's resolver once compiled, but webpack
    // needs to be told the source file is still TypeScript).
    cfg.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };

    // `serverExternalPackages` did not keep libsql's native-binary loader (or
    // @brightdata/cli's bundled browser-automation daemon) out of the bundle
    // here — they sit two hops behind a `transpilePackages` entry, and the
    // externals list apparently does not reach that far. Setting webpack's
    // own `externals` directly does. Both packages are only ever used
    // server-side: libsql via Node's native `require()`, and @brightdata/cli
    // by resolving its file path and spawning it as a subprocess (see
    // `@molt/brightdata`'s `resolveCliEntry` / `runCli`) — never imported and
    // executed in-process, so bundling its ~40MB of Playwright internals would
    // be pure waste even if it worked.
    if (isServer) {
      const existing = Array.isArray(cfg.externals) ? cfg.externals : [];
      cfg.externals = [
        ...existing,
        '@libsql/client',
        'libsql',
        '@libsql/hrana-client',
        '@libsql/isomorphic-fetch',
        '@libsql/isomorphic-ws',
        '@brightdata/cli',
        'playwright-core',
      ];
    }

    return cfg;
  },
};

export default config;
