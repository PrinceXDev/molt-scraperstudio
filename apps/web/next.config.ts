import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { NextConfig } from 'next';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Workspace packages are consumed as TypeScript source, not prebuilt output —
 * `@molt/health`, `@molt/store` etc. export `./src/index.ts` directly (see each
 * package's `exports` map). Next.js only transpiles packages it is told to.
 */
const config: NextConfig = {
  // On Vercel, the Root Directory is `apps/web`, but pnpm hoists the real
  // node_modules (including the externalized, native-binary packages below)
  // into the monorepo root's `.pnpm` store. Without this, output file tracing
  // never walks up far enough to include them in the deployed function, and
  // `require('@libsql/client')` fails at runtime with MODULE_NOT_FOUND even
  // though the build succeeds.
  outputFileTracingRoot: resolve(__dirname, '../..'),
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
  // NOTE: only `@libsql/client` (the Node build's dead code path for local
  // `file:`/`:memory:` URLs, unused in production) and `libsql` (its native
  // binary) stay external below. `@libsql/hrana-client`,
  // `@libsql/isomorphic-fetch`, and `@libsql/isomorphic-ws` back the `/web`
  // build's remote `libsql://` path instead — pure JS, no native binary — and
  // must bundle normally or the same MODULE_NOT_FOUND recurs for them.
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
        '@brightdata/cli',
        'playwright-core',
      ];
    }

    return cfg;
  },
};

export default config;
