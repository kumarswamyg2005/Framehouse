import type { NextConfig } from 'next'

/**
 * Sent on every response. The Content-Security-Policy is the one worth reading:
 *
 *   img-src  must allow the storage origin, because every photograph is a
 *            presigned URL pointing at R2 (or MinIO locally) rather than a file
 *            served from this domain.
 *   connect-src likewise — the browser PUTs upload bytes straight to storage.
 *   frame-ancestors 'none' — a gallery link behind a PIN should not be
 *            embeddable in someone else's page.
 *
 * 'unsafe-inline' remains in style-src because Next injects inline styles for
 * fonts and CSS modules; removing it needs nonce plumbing through the document,
 * which is noted in the README rather than half-done here.
 */
function contentSecurityPolicy(): string {
  const storage = process.env.R2_ENDPOINT
    ? new URL(process.env.R2_ENDPOINT).origin
    : `https://${process.env.R2_ACCOUNT_ID ?? '*'}.r2.cloudflarestorage.com`

  return [
    "default-src 'self'",
    // Next's runtime needs eval in development only.
    process.env.NODE_ENV === 'development'
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // next/font downloads Google Fonts at build time and serves them from this
    // origin, so no external font host is needed — or permitted.
    "font-src 'self' data:",
    `img-src 'self' blob: data: ${storage}`,
    `connect-src 'self' ${storage}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

const config: NextConfig = {
  // Photo bytes are delivered exclusively through presigned URLs minted after an
  // authorization check, so next/image's optimiser — which would have to fetch
  // and cache those URLs, becoming a second and unauthenticated way to reach the
  // bytes — is deliberately not in the path. See lib/auth/policy.ts.
  images: { unoptimized: true },
  serverExternalPackages: ['@node-rs/argon2', 'sharp'],
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // Presigned URLs and anything derived from a session must not sit in a
        // shared cache.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}

export default config
