import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { hashSecret } from '@/lib/auth/hash'
import { startSession } from '@/lib/auth/session'
import { ApiError, handler, parseBody } from '@/lib/http'
import { registerSchema } from '@/lib/schemas'

/**
 * Self-serve registration creates an ADMIN — a photography lead setting up their
 * workspace. Team members never register; the lead creates them from inside an
 * event, which is the only way a MEMBER row comes into existence.
 */
export const POST = handler(async (request: Request) => {
  const { name, email, password } = await parseBody(request, registerSchema)

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw new ApiError('CONFLICT', 'An account with that email already exists. Sign in instead.')
  }

  const user = await prisma.user.create({
    data: { name, email, role: 'ADMIN', passwordHash: await hashSecret(password) },
    select: { id: true, name: true, email: true, role: true },
  })

  await startSession(user)
  return NextResponse.json({ user }, { status: 201 })
})
