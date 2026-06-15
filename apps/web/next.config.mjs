/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  transpilePackages: [
    "@tenderlo/shared",
    "@tenderlo/db",
    "@tenderlo/intelligence",
    "@tenderlo/scoring",
    "@tenderlo/notifications",
    "@tenderlo/sources",
    "@tenderlo/parsing",
    "@tenderlo/worker"
  ]
};

export default nextConfig;
