import { redirect } from 'next/navigation'

export default function Page() {
  // Server-side redirect to avoid client hydration differences
  redirect('/home')
}
