/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true
  },
  async rewrites() {
    const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN || 'http://localhost:4000';
    return [
      { source: '/api/:path*', destination: `${apiOrigin}/:path*` }
    ];
  }
};

module.exports = nextConfig;
