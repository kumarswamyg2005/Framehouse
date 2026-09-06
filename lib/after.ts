import { after } from 'next/server'

/**
 * Runs work once the response has been sent.
 *
 * `after()` needs a request context. In tests, the seed script and any other
 * direct call there is none, and it throws — so this falls back to awaiting the
 * work inline. That keeps the same function usable from a route handler and
 * from a script without either caller knowing which it is.
 */
export async function afterResponse(work: () => Promise<void>): Promise<void> {
  try {
    after(work)
  } catch {
    await work()
  }
}
