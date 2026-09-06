import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/AuthForm'
import { getActor } from '@/lib/auth/session'

export const metadata = { title: 'Sign in · Framehouse' }

export default async function LoginPage() {
  if (await getActor()) redirect('/events')
  return <AuthForm mode="login" />
}
