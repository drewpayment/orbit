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
import { MessageSquare, Star, Bug, Lightbulb, HelpCircle } from 'lucide-react'
import { useState } from 'react'

export default function FeedbackPage() {
  const { data: session } = useSession()
  const [category, setCategory] = useState('general')
  const [rating, setRating] = useState(0)

  const user = session?.user

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
            {/* Feedback Form */}
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
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      defaultValue={user?.email || ''}
                      placeholder="your.email@example.com"
                    />
                  </div>
                </div>

                {/* Subject */}
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    placeholder="Brief summary of your feedback"
                  />
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    placeholder="Tell us more about your feedback, suggestions, or issues..."
                    className="min-h-[150px]"
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
                    />
                  </div>
                )}

                {/* File Attachment Info */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-400">
                    <strong>Need to attach files?</strong> You can include screenshots, logs, or other files
                    by emailing your feedback directly to <a href="mailto:feedback@orbit.dev" className="underline">feedback@orbit.dev</a>
                  </p>
                </div>

                {/* Submit Button */}
                <div className="flex gap-4">
                  <Button className="flex-1">Submit Feedback</Button>
                  <Button variant="outline">Cancel</Button>
                </div>
              </CardContent>
            </Card>

            {/* Response Time Info */}
            <Card>
              <CardHeader>
                <CardTitle>What Happens Next?</CardTitle>
                <CardDescription>
                  Our feedback process
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3 text-sm">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold">
                      1
                    </div>
                    <div>
                      <p className="font-medium">Acknowledgment</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        You'll receive a confirmation email within 24 hours
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold">
                      2
                    </div>
                    <div>
                      <p className="font-medium">Review</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        Our team reviews your feedback and categorizes it
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold">
                      3
                    </div>
                    <div>
                      <p className="font-medium">Action</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        We'll respond or implement changes based on priority
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold">
                      4
                    </div>
                    <div>
                      <p className="font-medium">Follow-up</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        You may receive updates about your feedback
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
