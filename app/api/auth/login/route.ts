import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { hashSecret, verifySecret } from '@/lib/auth/hash'
import { startSession } from '@/lib/auth/session'
import { ApiError, handler, parseBody } from '@/lib/http'
import { loginSchema } from '@/lib/schemas'

// A precomputed hash of a value nobody will ever submit. When the email is
// unknown we verify against this instead of returning early, so a missing
// account costs the same wall-clock time as a wrong password and the endpoint
// cannot be used to enumerate who has an account.
const DECOY_HASH_PROMISE = hashSecret(crypto.randomUUID())

export const POST = handler(async (request: Request) => {
  const { email, password } = await parseBody(request, loginSchema)

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, passwordHash: true },
  })

  const passwordMatches = user
    ? await verifySecret(user.passwordHash, password)
    : await verifySecret(await DECOY_HASH_PROMISE, password)

  if (!user || !passwordMatches) {
    // Deliberately identical for both failure modes.
    throw new ApiError('UNAUTHENTICATED', 'That email and password don’t match.')
  }

  const { passwordHash: _passwordHash, ...safeUser } = user
  await startSession(safeUser)
  return NextResponse.json({ user: safeUser })
})
