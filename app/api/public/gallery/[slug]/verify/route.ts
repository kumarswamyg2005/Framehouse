import { NextResponse } from 'next/server'
import { grantGalleryAccess } from '@/lib/auth/session'
import { verifyGalleryPin } from '@/lib/data/gallery'
import { handler, parseBody } from '@/lib/http'
import { clientIp, hashIp } from '@/lib/rate-limit'
import { verifyPinSchema } from '@/lib/schemas'

type Params = { params: Promise<{ slug: string }> }

/**
 * The only unauthenticated write in the app. Rate-limited per gallery per IP,
 * and deliberately incapable of distinguishing "wrong PIN" from "no such
 * gallery" in either its response or its timing.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { slug } = await params
  const input = await parseBody(request, verifyPinSchema)

  await verifyGalleryPin(slug, hashIp(clientIp(request)), input)
  await grantGalleryAccess(slug)

  return NextResponse.json({ ok: true })
})
