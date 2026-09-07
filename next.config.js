/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    // Keep the Postgres driver out of the webpack bundle (it has optional native bindings).
    serverComponentsExternalPackages: ['pg', 'ws'],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // lib/setpoints.js (shared with the browser for live snapshots) only touches fs/path inside the
      // server-only loader; stub them out of the client bundle instead of pulling in polyfills.
      config.resolve.fallback = { ...(config.resolve.fallback || {}), fs: false, path: false };
    }
    return config;
  },
};
module.exports = nextConfig;
