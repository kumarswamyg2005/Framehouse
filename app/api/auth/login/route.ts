import { NextResponse } from 'next/server'
import { startSession } from '@/lib/auth/session'
import { authenticate } from '@/lib/data/accounts'
import { handler, parseBody } from '@/lib/http'
import { clientIp, hashIp } from '@/lib/rate-limit'
import { loginSchema } from '@/lib/schemas'

export const POST = handler(async (request: Request) => {
  const input = await parseBody(request, loginSchema)
  const user = await authenticate(input, hashIp(clientIp(request)))
  await startSession(user)
  return NextResponse.json({ user })
})
