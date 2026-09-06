import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { publishGallery } from '@/lib/data/gallery'
import { handler, parseBody } from '@/lib/http'
import { publishSchema } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

// Returns the slug. It never returns the PIN — the lead typed it, and it is a
// one-way argon2id hash from the moment it arrives.
export const POST = handler(async (request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  const input = await parseBody(request, publishSchema)
  return NextResponse.json(await publishGallery(actor, id, input))
})
