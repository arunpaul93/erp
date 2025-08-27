import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use in-memory webpack cache to avoid OneDrive rename/locking issues on Windows
  webpack: (config) => {
    // Disable persistent filesystem cache to reduce ENOENT/rename warnings
    // You can switch to { type: 'filesystem' } if not using OneDrive/redirected folders
    (config as any).cache = { type: 'memory' };
    return config;
  },
};

export default nextConfig;
