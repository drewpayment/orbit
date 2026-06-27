import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: !!process.env.DOCKER_BUILD },
  // Temporal's SDK is server-only (gRPC to the Temporal server) and relies on
  // dynamic require() expressions that webpack can't statically analyze. Keeping
  // these packages external means Next never bundles them, which silences the
  // recurring "Critical dependency: the request of a dependency is an expression"
  // warning emitted from @temporalio/common.
  serverExternalPackages: [
    '@temporalio/client',
    '@temporalio/common',
    '@temporalio/proto',
  ],
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    // Belt-and-suspenders: ignore the dynamic-require warning from @temporalio/common
    // in case any transitive path still pulls it through the bundler.
    webpackConfig.ignoreWarnings = [
      ...(webpackConfig.ignoreWarnings ?? []),
      { module: /@temporalio[\\/]common/, message: /the request of a dependency is an expression/ },
    ]

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
