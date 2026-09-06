import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '@/lib/env'

// Cloudflare R2 speaks the S3 API. The bucket has no public access policy and no
// custom domain bound to it: the only way bytes leave R2 is a presigned URL this
// server mints, and it only mints one after an authorization check.
let client: S3Client | null = null

export function r2(): S3Client {
  if (client) return client
  const e = env()
  client = new S3Client({
    region: 'auto',
    endpoint: e.R2_ENDPOINT ?? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: e.R2_ACCESS_KEY_ID,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    },
  })
  return client
}

export function bucket(): string {
  return env().R2_BUCKET
}

/** Server-side upload. The browser upload path uses a presigned PUT instead. */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await r2().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType })
  )
}
