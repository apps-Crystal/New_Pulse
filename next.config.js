/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // The dashboard proxies /api/plc to the local bridge so the browser stays same-origin.
  env: {
    BRIDGE_URL: process.env.BRIDGE_URL || 'http://localhost:4000',
  },
};
module.exports = nextConfig;
