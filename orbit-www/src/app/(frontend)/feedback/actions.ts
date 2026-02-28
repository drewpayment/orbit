'use server'

import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getCurrentUser } from '@/lib/auth/session'

interface FeedbackInput {
  category: string
  rating: number
  name: string
  email: string
  subject: string
  message: string
  steps?: string
}

export async function submitFeedback(input: FeedbackInput) {
  const user = await getCurrentUser()
  if (!user) {
    return { success: false, error: 'You must be signed in to submit feedback.' }
  }

  const { category, rating, name, email, subject, message, steps } = input

  if (!name || !email || !subject || !message) {
    return { success: false, error: 'Please fill in all required fields.' }
  }

  const payload = await getPayload({ config: configPromise })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (payload as any).create({
    collection: 'feedback',
    data: {
      category,
      rating,
      name,
      email,
      subject,
      message,
      steps: category === 'bug' ? steps : undefined,
      submittedBy: user.id,
    },
  })

  return { success: true }
}
