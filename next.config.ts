import type { NextConfig } from "next";
import path from "path";
import webpack from "webpack";

const nextConfig: NextConfig = {
  // Force Next to treat this folder as the workspace root (fixes multi lockfile monorepo inference)
  outputFileTracingRoot: path.join(__dirname),
  // Use in-memory webpack cache to avoid OneDrive rename/locking issues on Windows
  webpack: (config, { isServer }) => {
    // Disable persistent filesystem cache to reduce ENOENT/rename warnings
    // You can switch to { type: 'filesystem' } if not using OneDrive/redirected folders
    (config as any).cache = { type: 'memory' };

    // Only apply browser polyfills to the client build
    if (!isServer) {
      // Polyfill Node globals used by some browser bundles (e.g., Supabase storage uses Buffer)
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        buffer: require.resolve("buffer/"),
        process: require.resolve("process/browser"),
      };

      config.plugins = config.plugins || [];
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
          process: ["process"],
        })
      );
    }
    return config;
  },
};

export default nextConfig;
