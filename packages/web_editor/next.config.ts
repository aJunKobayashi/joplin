import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['faiss-node', 'keytar', 'sharp', '@electron/remote'],
  turbopack: {
    resolveAlias: {
      electron: './stubs/electron.js',
    },
  },
};

export default nextConfig;
