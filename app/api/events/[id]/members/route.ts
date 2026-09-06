import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { addMember } from '@/lib/data/events'
import { handler, parseBody } from '@/lib/http'
import { addMemberSchema } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

export const POST = handler(async (request: Request, { params }: Params) => {
  const actor = await requireActor()
  const { id } = await params
  const input = await parseBody(request, addMemberSchema)

  // temporaryPassword is non-null only when this call created the account. It is
  // returned once, here, and never stored in a readable form.
  const result = await addMember(actor, id, input)
  return NextResponse.json(result, { status: 201 })
})
