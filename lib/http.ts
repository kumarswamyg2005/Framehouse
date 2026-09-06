import { NextResponse } from 'next/server'
import { ZodError, type ZodSchema } from 'zod'

/**
 * One error envelope for every route handler: { error: { code, message } }.
 * Messages are written for the person who will read them in a toast, and never
 * contain anything the caller was not already entitled to know.
 */

export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  UPLOAD_FAILED: 502,
  CONFLICT: 409,
  INTERNAL: 500,
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly headers: Record<string, string>

  constructor(code: ErrorCode, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.headers = headers
  }

  get status(): number {
    return STATUS[this.code]
  }
}

export const unauthenticated = () => new ApiError('UNAUTHENTICATED', 'Sign in to continue.')

export const forbidden = (message = 'You do not have access to do that.') =>
  new ApiError('FORBIDDEN', message)

/**
 * Used for anything the actor is not entitled to see the existence of. Reaching
 * for this instead of `forbidden` is the default for cross-tenant reads —
 * invariant in policy.ts, and the reason is written up in docs/DECISIONS.md.
 */
export const notFound = (message = 'Not found.') => new ApiError('NOT_FOUND', message)

export const rateLimited = (message: string, retryAfterSeconds: number) =>
  new ApiError('RATE_LIMITED', message, { 'Retry-After': String(retryAfterSeconds) })

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: error.headers }
    )
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: ErrorCode.VALIDATION_ERROR, message: firstZodMessage(error) } },
      { status: 400 }
    )
  }

  // Unexpected: log the detail server-side, tell the caller nothing about it.
  console.error('[api] unhandled', error)
  return NextResponse.json(
    { error: { code: ErrorCode.INTERNAL, message: 'Something went wrong on our end.' } },
    { status: 500 }
  )
}

function firstZodMessage(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'That request was not valid.'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

/** Wraps a handler so every thrown ApiError/ZodError becomes the envelope. */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

/** Parses a JSON body against a schema. Invalid JSON is a validation error. */
export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Expected a JSON body.')
  }
  return schema.parse(raw)
}
