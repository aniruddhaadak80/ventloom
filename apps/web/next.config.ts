import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` here on purpose. Next's standalone tracing
  // recreates node_modules using symlinks, and Windows refuses that without an
  // elevated or developer-mode shell, so the build fails at the very last step
  // with EPERM. The Docker image copies node_modules instead, which is a
  // marginally larger image and works on every platform.
  //
  // The workspace packages ship TypeScript sources with ESM-style `.js`
  // extension specifiers, which is what `moduleResolution: "bundler"` wants.
  // Next must compile them rather than treat them as pre-built node_modules.
  transpilePackages: ["@repo/core", "@repo/seed", "@repo/ui", "@repo/sdk"],

  experimental: {
    optimizePackageImports: ["@repo/ui"],
  },

  webpack(config) {
    // Without this, webpack resolves the literal `./mogi.js` in
    // `packages/core/src/index.ts` and fails: the `.js` to `.ts` extension
    // alias is only applied to files inside the app's own tree, and workspace
    // packages are symlinked into node_modules.
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx"],
      ".mjs": [".mjs", ".mts", ".ts"],
      ".cjs": [".cjs", ".cts"],
    };
    return config;
  },

  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.vercel.app" }],
  },

  // The observatory is a build-time deterministic app, so the build id is the
  // world seed rather than a timestamp: identical sources must give identical
  // output, which is the same property the rest of the repo relies on.
  generateBuildId: () => "ventloom-7331",
};

export default nextConfig;
