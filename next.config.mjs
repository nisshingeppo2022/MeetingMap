/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    serverComponentsExternalPackages: ["pg", "@prisma/client", "@prisma/adapter-pg"],
  },
};

export default nextConfig;
