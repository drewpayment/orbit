'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useSession } from '@/lib/auth-client'
import { MessageSquare, Star, Bug, Lightbulb, HelpCircle, CheckCircle2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { submitFeedback } from './actions'

export default function FeedbackPage() {
  const { data: session } = useSession()
  const [category, setCategory] = useState('general')
  const [rating, setRating] = useState(0)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [steps, setSteps] = useState('')
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [isPending, startTransition] = useTransition()

  const user = session?.user

  function handleSubmit() {
    setError('')
    startTransition(async () => {
      const result = await submitFeedback({
        category,
        rating,
        name: user?.name || '',
        email: user?.email || '',
        subject,
        message,
        steps: category === 'bug' ? steps : undefined,
      })
      if (result.success) {
        setSubmitted(true)
      } else {
        setError(result.error || 'Something went wrong.')
      }
    })
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Send Feedback
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Help us improve by sharing your thoughts and suggestions
            </p>
          </div>

          <div className="grid gap-6 max-w-4xl">
            {submitted ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-4 py-12">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                  <h2 className="text-2xl font-semibold">Thank you for your feedback!</h2>
                  <p className="text-gray-600 dark:text-gray-400">
                    We appreciate you taking the time to share your thoughts.
                  </p>
                  <Button variant="outline" onClick={() => {
                    setSubmitted(false)
                    setCategory('general')
                    setRating(0)
                    setSubject('')
                    setMessage('')
                    setSteps('')
                  }}>
                    Send More Feedback
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Share Your Feedback</CardTitle>
                  <CardDescription>
                    We value your input and read every submission
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Category Selection */}
                  <div className="space-y-3">
                    <Label>Feedback Category</Label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <button
                        onClick={() => setCategory('general')}
                        className={`p-4 border rounded-lg flex flex-col items-center gap-2 transition-colors ${
                          category === 'general'
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <MessageSquare className={`h-6 w-6 ${category === 'general' ? 'text-blue-600' : 'text-gray-500'}`} />
                        <span className="text-sm font-medium">General</span>
                      </button>

                      <button
                        onClick={() => setCategory('bug')}
                        className={`p-4 border rounded-lg flex flex-col items-center gap-2 transition-colors ${
                          category === 'bug'
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Bug className={`h-6 w-6 ${category === 'bug' ? 'text-blue-600' : 'text-gray-500'}`} />
                        <span className="text-sm font-medium">Bug Report</span>
                      </button>

                      <button
                        onClick={() => setCategory('feature')}
                        className={`p-4 border rounded-lg flex flex-col items-center gap-2 transition-colors ${
                          category === 'feature'
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Lightbulb className={`h-6 w-6 ${category === 'feature' ? 'text-blue-600' : 'text-gray-500'}`} />
                        <span className="text-sm font-medium">Feature Request</span>
                      </button>

                      <button
                        onClick={() => setCategory('question')}
                        className={`p-4 border rounded-lg flex flex-col items-center gap-2 transition-colors ${
                          category === 'question'
                            ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <HelpCircle className={`h-6 w-6 ${category === 'question' ? 'text-blue-600' : 'text-gray-500'}`} />
                        <span className="text-sm font-medium">Question</span>
                      </button>
                    </div>
                  </div>

                  {/* Rating */}
                  <div className="space-y-2">
                    <Label>How would you rate your experience?</Label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setRating(star)}
                          className="transition-transform hover:scale-110"
                        >
                          <Star
                            className={`h-8 w-8 ${
                              star <= rating
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-gray-300 dark:text-gray-600'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Your Name</Label>
                      <Input
                        id="name"
                        defaultValue={user?.name || ''}
                        placeholder="Enter your name"
                        readOnly
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <Input
                        id="email"
                        type="email"
                        defaultValue={user?.email || ''}
                        placeholder="your.email@example.com"
                        readOnly
                      />
                    </div>
                  </div>

                  {/* Subject */}
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject</Label>
                    <Input
                      id="subject"
                      placeholder="Brief summary of your feedback"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                    />
                  </div>

                  {/* Message */}
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      placeholder="Tell us more about your feedback, suggestions, or issues..."
                      className="min-h-[150px]"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </div>

                  {/* Additional Context */}
                  {category === 'bug' && (
                    <div className="space-y-2">
                      <Label htmlFor="steps">Steps to Reproduce (for bugs)</Label>
                      <Textarea
                        id="steps"
                        placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."
                        className="min-h-[100px] font-mono text-sm"
                        value={steps}
                        onChange={(e) => setSteps(e.target.value)}
                      />
                    </div>
                  )}

                  {error && (
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  )}

                  {/* Submit Button */}
                  <div className="flex gap-4">
                    <Button className="flex-1" onClick={handleSubmit} disabled={isPending}>
                      {isPending ? 'Submitting...' : 'Submit Feedback'}
                    </Button>
                    <Button variant="outline" onClick={() => window.history.back()}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
