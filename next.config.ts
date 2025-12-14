import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Empty turbopack config to silence the warning
  // Turbopack handles WASM and fallbacks automatically
  turbopack: {},
};

export default nextConfig;
