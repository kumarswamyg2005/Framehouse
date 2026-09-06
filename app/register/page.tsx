import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/AuthForm'
import { getActor } from '@/lib/auth/session'

export const metadata = { title: 'Create a workspace · Framehouse' }

export default async function RegisterPage() {
  if (await getActor()) redirect('/events')
  return <AuthForm mode="register" />
}
