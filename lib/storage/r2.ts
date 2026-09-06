import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '@/lib/env'

/**
 * Object storage. Cloudflare R2 in production, MinIO in local development —
 * both speak the S3 API, so this is the only file that would change if the
 * provider did, and it does not change between the two.
 *
 * The bucket has no public access policy and no custom domain bound to it. The
 * only way bytes enter or leave is a presigned URL minted here, and nothing
 * mints one without first passing through lib/auth/policy.ts.
 */

/** Long enough to load a page of thumbnails, short enough that a leaked URL
 *  from a browser history or a shared screenshot is dead on arrival. */
export const GET_URL_TTL_SECONDS = 5 * 60

/** The browser must presign, upload, and confirm inside this window. */
export const PUT_URL_TTL_SECONDS = 10 * 60

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

let client: S3Client | null = null

export function r2(): S3Client {
  if (client) return client
  const e = env()
  client = new S3Client({
    region: 'auto',
    endpoint: e.R2_ENDPOINT ?? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    // Path-style works on both R2 and MinIO; virtual-host style does not work
    // against a bare localhost endpoint.
    forcePathStyle: true,
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

/**
 * A presigned PUT the browser uploads to directly. ContentType and
 * ContentLength are baked into the signature, so a client that presigns a 2 MB
 * jpeg cannot then upload a 2 GB video: the upload is rejected by storage, not
 * by us.
 */
export function presignUpload(
  key: string,
  contentType: string,
  contentLength: number
): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: PUT_URL_TTL_SECONDS }
  )
}

/** A presigned GET. Minted only after an authorization check. */
export function presignDownload(key: string, downloadAs?: string): Promise<string> {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ...(downloadAs
        ? { ResponseContentDisposition: `attachment; filename="${sanitiseFilename(downloadAs)}"` }
        : {}),
    }),
    { expiresIn: GET_URL_TTL_SECONDS }
  )
}

export type ObjectFacts = { size: number; contentType: string | undefined }

/**
 * Confirms the object really landed, and reports what actually arrived rather
 * than what the client claimed. This is what keeps orphaned metadata out of the
 * database: no Photo row is written until this resolves.
 */
export async function headObject(key: string): Promise<ObjectFacts | null> {
  try {
    const result = await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
    return { size: result.ContentLength ?? 0, contentType: result.ContentType }
  } catch {
    return null
  }
}

/** Server-side read, used to generate a thumbnail from the uploaded original. */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const result = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
  if (!result.Body) throw new Error(`Object ${key} has no body`)
  return new Uint8Array(await result.Body.transformToByteArray())
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  await r2().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType })
  )
}

export async function deleteObjects(keys: string[]): Promise<void> {
  const present = keys.filter(Boolean)
  if (present.length === 0) return

  if (present.length === 1) {
    await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: present[0] }))
    return
  }

  await r2().send(
    new DeleteObjectsCommand({
      Bucket: bucket(),
      Delete: { Objects: present.map((Key) => ({ Key })), Quiet: true },
    })
  )
}

/** Content-Disposition is a header: a filename with a quote or newline in it
 *  would let a caller inject one. Strip anything that is not plainly a name. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'photo.jpg'
}
