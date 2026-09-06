import { redirect } from 'next/navigation'

// There is no marketing surface. Everything behind this point is either the
// workspace (authenticated) or a gallery link (PIN-gated).
export default function Home() {
  redirect('/login')
}
