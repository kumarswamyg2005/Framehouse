/**
 * Creates the development and test buckets in local MinIO. Cloudflare R2
 * buckets are created once in the dashboard, so this is local-only.
 *
 *   node scripts/create-buckets.mjs
 */
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'

process.loadEnvFile('.env')

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

for (const bucket of [process.env.R2_BUCKET, 'framehouse-test']) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    console.log(`exists   ${bucket}`)
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
    console.log(`created  ${bucket}`)
  }
}
