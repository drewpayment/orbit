import { redirect } from 'next/navigation'

// Support page is behind a feature flag — redirect to feedback for now
export default function SupportPage() {
  redirect('/feedback')
}
