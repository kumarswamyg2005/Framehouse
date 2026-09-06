import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/session'
import { handler } from '@/lib/http'

// The Actor shape has no passwordHash field, so there is no way for one to be
// serialised here by accident.
export const GET = handler(async () => {
  const actor = await requireActor()
  return NextResponse.json({ user: actor })
})
