import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // @orbit/automation-worker is an internal workspace package that ships raw TS
  // (its `exports` point at .ts). Next must transpile it like app source. Only
  // the client-safe `./shared` subpath is ever imported by the app; the
  // `./worker` runtime (and @temporalio/worker) is never reached from here.
  transpilePackages: ['@orbit/automation-worker'],
  typescript: { ignoreBuildErrors: !!process.env.DOCKER_BUILD },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
