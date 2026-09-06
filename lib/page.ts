import { notFound as renderNotFound } from 'next/navigation'
import { ApiError } from '@/lib/http'

/**
 * Bridges the API error envelope into Next's page-level 404. Server components
 * call the same policy-scoped data functions the route handlers do, so a
 * NOT_FOUND from policy.ts must render the 404 page rather than a 500 — a 500
 * would itself be a signal that the resource exists.
 */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') renderNotFound()
    throw error
  }
}
