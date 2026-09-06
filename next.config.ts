import type { NextConfig } from 'next'

const config: NextConfig = {
  // Photo bytes are delivered exclusively through presigned R2 URLs minted after
  // an authorization check, so next/image's optimizer (which would need to fetch
  // and cache those URLs) is deliberately not in the path. See lib/auth/policy.ts.
  images: { unoptimized: true },
  serverExternalPackages: ['@node-rs/argon2', 'sharp'],
}

export default config
