import type { NextConfig } from 'next'

// Next 16 removed ESLint-during-build integration entirely: the `eslint`
// key is gone from NextConfig and `ignoreDuringBuilds` no longer exists in
// the runtime, so the old block was dead config that failed typecheck.
// Linting still runs via eslint.config.js at the repo root.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
}

export default nextConfig
