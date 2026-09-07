import { NextResponse } from 'next/server'
import { endGalleryAccess } from '@/lib/auth/session'
import { handler } from '@/lib/http'

type Params = { params: Promise<{ slug: string }> }

/**
 * Locks the gallery again from the customer's side.
 *
 * Deliberately asks no questions: there is nothing to authorise about dropping
 * your own cookie, and a client who wants out should not have to prove anything
 * first. Unconditionally successful, so it works from a stale tab too.
 */
export const POST = handler(async (_request: Request, { params }: Params) => {
  const { slug } = await params
  await endGalleryAccess(slug)
  return NextResponse.json({ ok: true })
})
