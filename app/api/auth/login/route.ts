import { NextResponse } from 'next/server'
import { startSession } from '@/lib/auth/session'
import { authenticate } from '@/lib/data/accounts'
import { handler, parseBody } from '@/lib/http'
import { loginSchema } from '@/lib/schemas'

export const POST = handler(async (request: Request) => {
  const input = await parseBody(request, loginSchema)
  const user = await authenticate(input)
  await startSession(user)
  return NextResponse.json({ user })
})
