import { NextResponse } from 'next/server'
import { endSession } from '@/lib/auth/session'
import { handler } from '@/lib/http'

export const POST = handler(async () => {
  await endSession()
  return NextResponse.json({ ok: true })
})
