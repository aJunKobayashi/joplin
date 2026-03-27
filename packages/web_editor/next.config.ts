import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['faiss-node', 'keytar', 'sharp'],
  webpack(config, { dev }) {
    if (dev) {
      config.devtool = 'eval-source-map';
    }
    return config;
  },
};

export default nextConfig;
