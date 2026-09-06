import { NextResponse } from 'next/server'
import { startSession } from '@/lib/auth/session'
import { registerLead } from '@/lib/data/accounts'
import { handler, parseBody } from '@/lib/http'
import { registerSchema } from '@/lib/schemas'

export const POST = handler(async (request: Request) => {
  const input = await parseBody(request, registerSchema)
  const user = await registerLead(input)
  await startSession(user)
  return NextResponse.json({ user }, { status: 201 })
})
