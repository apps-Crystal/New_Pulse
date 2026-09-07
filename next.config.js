/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    // Keep the Postgres driver out of the webpack bundle (it has optional native bindings).
    serverComponentsExternalPackages: ['pg', 'ws'],
  },
};
module.exports = nextConfig;
