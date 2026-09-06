/**
 * Pre-deploy check.
 *
 * Verifies the things that are painful to discover from a failed deploy: that
 * every environment variable is present and plausible, that the database is
 * reachable and migrated, that object storage answers, and — the one worth
 * being loud about — that the bucket is not publicly readable.
 *
 *   node scripts/preflight.mjs
 *
 * Exits non-zero if anything fails, so it can gate a deploy step.
 */
import { PrismaClient } from '@prisma/client'
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// On a CI or Vercel host the environment is already populated and there is no
// .env file; loadEnvFile throws ENOENT rather than no-opping, which would crash
// this script exactly where it is meant to be useful.
try {
  process.loadEnvFile('.env')
} catch {
  // No .env — expected anywhere the environment is injected.
}

let failures = 0
const pass = (m) => console.log(`  ok    ${m}`)
const fail = (m) => {
  failures++
  console.log(`  FAIL  ${m}`)
}
const warn = (m) => console.log(`  warn  ${m}`)

console.log('\nEnvironment')
const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'IP_HASH_SALT',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'NEXT_PUBLIC_APP_URL',
]
for (const key of REQUIRED) {
  if (!process.env[key]) fail(`${key} is not set`)
}
if (failures) {
  console.log('\nStopping — fill in the environment first.\n')
  process.exit(1)
}
pass('all required variables present')

if ((process.env.JWT_SECRET ?? '').length < 32) fail('JWT_SECRET is shorter than 32 characters')
else pass('JWT_SECRET length')

if (/dev-only|test-only|changeme|secret123/i.test(process.env.JWT_SECRET ?? '')) {
  fail('JWT_SECRET still looks like a development placeholder')
} else pass('JWT_SECRET is not a placeholder')

if ((process.env.IP_HASH_SALT ?? '').length < 16) fail('IP_HASH_SALT is shorter than 16 characters')
else pass('IP_HASH_SALT length')

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
if (appUrl.endsWith('/')) fail('NEXT_PUBLIC_APP_URL has a trailing slash — gallery links will break')
else pass('NEXT_PUBLIC_APP_URL shape')

if (appUrl.startsWith('http://') && !appUrl.includes('localhost')) {
  fail('NEXT_PUBLIC_APP_URL is http:// — cookies are Secure in production and will not be sent')
} else pass('NEXT_PUBLIC_APP_URL scheme')

for (const key of ['SEED_ADMIN_PASSWORD', 'SEED_MEMBER_PASSWORD', 'SEED_GALLERY_PIN']) {
  if (process.env[key]) warn(`${key} is set — remove it from production once seeded`)
}

if (process.env.DEMO_MODE === 'true') {
  warn('DEMO_MODE is on — the entry page will publish demo sign-in credentials')
  warn('  and a link to the seeded gallery. Correct for a demo deployment;')
  warn('  unset it on anything with real clients on it.')
} else {
  pass('DEMO_MODE is off — the entry page advertises nothing')
}

console.log('\nDatabase')
const prisma = new PrismaClient()
try {
  await prisma.$queryRaw`SELECT 1`
  pass('reachable')

  const applied = await prisma.$queryRaw`
    SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`
  pass(`${applied.length} migration(s) applied`)

  const tables = [
    'User',
    'Event',
    'EventMember',
    'Photo',
    'Gallery',
    'GalleryPhoto',
    'AccessAttempt',
  ]
  for (const t of tables) {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM "${t}" LIMIT 1`)
  }
  pass('every expected table exists')
} catch (error) {
  fail(`database: ${error.message.split('\n')[0]}`)
} finally {
  await prisma.$disconnect()
}

console.log('\nObject storage')
const bucket = process.env.R2_BUCKET
const endpoint =
  process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
const s3 = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const probeKey = `preflight/${crypto.randomUUID()}.txt`
try {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }))
  pass(`bucket "${bucket}" reachable at ${new URL(endpoint).host}`)

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: probeKey,
      Body: new TextEncoder().encode('preflight'),
      ContentType: 'text/plain',
    })
  )
  pass('write')

  const signed = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: probeKey }), {
    expiresIn: 60,
  })
  const viaSigned = await fetch(signed)
  if (viaSigned.ok) pass('presigned read')
  else fail(`presigned read returned ${viaSigned.status}`)

  // An unsigned read of the S3 API endpoint. This catches an S3 or MinIO bucket
  // policy that allows anonymous GET.
  //
  // It does NOT prove a Cloudflare R2 bucket is private. R2 serves public
  // objects from a separate pub-<hash>.r2.dev origin (or a custom domain), and
  // the S3 API endpoint rejects unsigned requests unconditionally whether or not
  // public access is switched on — so on R2 this assertion would pass either
  // way. Set R2_PUBLIC_PROBE_URL to the r2.dev or custom-domain URL of any
  // object to actually test it.
  const unsigned = signed.split('?')[0]
  const viaPublic = await fetch(unsigned)
  if (viaPublic.ok) {
    fail(`S3 endpoint served an unsigned read (${viaPublic.status}) at ${unsigned}`)
    fail('  a bucket policy is allowing anonymous GET — every photo is world-readable')
  } else {
    pass(`S3 endpoint refused an unsigned read (${viaPublic.status})`)
  }

  const publicProbe = process.env.R2_PUBLIC_PROBE_URL
  if (publicProbe) {
    const res = await fetch(publicProbe)
    if (res.ok) {
      fail(`BUCKET IS PUBLICLY READABLE — ${publicProbe} returned ${res.status}`)
      fail('  turn off public access in the R2 dashboard before deploying')
    } else {
      pass(`public origin refused the read (${res.status})`)
    }
  } else if (endpoint.includes('r2.cloudflarestorage.com')) {
    warn('R2 public access NOT verified by this script — the S3 endpoint always')
    warn('  refuses unsigned reads, so the check above cannot detect it.')
    warn('  Confirm in the R2 dashboard that Public Development URL is disabled')
    warn('  and no custom domain is attached, or set R2_PUBLIC_PROBE_URL and')
    warn('  re-run to have this asserted.')
  }

} catch (error) {
  fail(`storage: ${error.message.split('\n')[0]}`)
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: probeKey })).catch(() => {})
}

console.log(
  failures === 0
    ? '\nPreflight passed.\n'
    : `\nPreflight failed with ${failures} problem(s).\n`
)
process.exit(failures === 0 ? 0 : 1)
