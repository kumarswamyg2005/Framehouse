import { z } from 'zod'

/**
 * Every route handler parses its input through one of these. Nothing reads
 * request.json() and indexes into the result directly.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address.')

// Length is the only rule. Composition rules push people toward Passw0rd! and
// argon2id already makes offline cracking expensive.
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.')

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: emailSchema,
  password: passwordSchema,
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(200),
})

export const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The PIN is six digits.')

export const createEventSchema = z.object({
  name: z.string().trim().min(1, 'Give the event a name.').max(160),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  // Accepts an <input type="date"> value or a full ISO timestamp.
  date: z
    .string()
    .trim()
    .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Enter a valid date.')
    .optional(),
})

export const addMemberSchema = z.object({
  email: emailSchema,
  // Only used when the email does not already belong to an account.
  name: z.string().trim().min(1).max(120).optional(),
})
