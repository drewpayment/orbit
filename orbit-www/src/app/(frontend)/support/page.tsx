import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { BookOpen, MessageCircle, Mail, FileQuestion, ExternalLink } from 'lucide-react'

export default function SupportPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Support & Help Center
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Get help and find answers to your questions
            </p>
          </div>

          <div className="grid gap-6 max-w-4xl">
            {/* Quick Actions */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                      <BookOpen className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <CardTitle>Documentation</CardTitle>
                      <CardDescription>Browse our guides</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Comprehensive guides, tutorials, and API references to help you get started
                  </p>
                  <Button variant="outline" className="w-full" asChild>
                    <a href="#" className="flex items-center justify-center gap-2">
                      View Docs
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </CardContent>
              </Card>

              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                      <MessageCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <CardTitle>Live Chat</CardTitle>
                      <CardDescription>Chat with support</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Get instant help from our support team during business hours
                  </p>
                  <Button className="w-full">Start Chat</Button>
                </CardContent>
              </Card>
            </div>

            {/* Contact Methods */}
            <Card>
              <CardHeader>
                <CardTitle>Contact Support</CardTitle>
                <CardDescription>
                  Choose how you'd like to reach us
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                  <Mail className="h-6 w-6 text-gray-500 mt-1" />
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1">Email Support</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      Send us an email and we'll respond within 24 hours
                    </p>
                    <a href="mailto:support@orbit.dev" className="text-sm text-blue-600 hover:underline">
                      support@orbit.dev
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                  <FileQuestion className="h-6 w-6 text-gray-500 mt-1" />
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1">Submit a Ticket</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                      Create a support ticket for detailed assistance
                    </p>
                    <Button variant="link" className="p-0 h-auto">
                      Create Ticket →
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* FAQ */}
            <Card>
              <CardHeader>
                <CardTitle>Frequently Asked Questions</CardTitle>
                <CardDescription>
                  Quick answers to common questions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                    <span className="font-medium">How do I create a new workspace?</span>
                    <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="mt-2 p-3 text-sm text-gray-600 dark:text-gray-400">
                    Navigate to the Workspaces page and click "Create Workspace". Fill in the required information
                    including name, slug, and description. Click "Save" to create your workspace.
                  </div>
                </details>

                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                    <span className="font-medium">How do I invite team members?</span>
                    <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="mt-2 p-3 text-sm text-gray-600 dark:text-gray-400">
                    Go to your workspace settings, select "Members", and click "Invite Member". Enter their email
                    address and select their role. They'll receive an invitation email.
                  </div>
                </details>

                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                    <span className="font-medium">What payment methods do you accept?</span>
                    <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="mt-2 p-3 text-sm text-gray-600 dark:text-gray-400">
                    We accept all major credit cards (Visa, MasterCard, American Express) and debit cards.
                    Enterprise customers can also pay via invoice.
                  </div>
                </details>

                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg">
                    <span className="font-medium">Can I cancel my subscription anytime?</span>
                    <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="mt-2 p-3 text-sm text-gray-600 dark:text-gray-400">
                    Yes, you can cancel your subscription at any time from the Billing page. You'll continue to
                    have access until the end of your current billing period.
                  </div>
                </details>
              </CardContent>
            </Card>

            {/* Status Page */}
            <Card>
              <CardHeader>
                <CardTitle>System Status</CardTitle>
                <CardDescription>
                  Check the current status of our services
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-400">All Systems Operational</p>
                      <p className="text-sm text-green-700 dark:text-green-500">No issues reported</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a href="#" className="flex items-center gap-2">
                      View Status Page
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Still Need Help */}
            <Card>
              <CardHeader>
                <CardTitle>Still Need Help?</CardTitle>
                <CardDescription>
                  We're here to assist you
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-4">
                <Button asChild>
                  <Link href="/feedback">Send Feedback</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/account">Account Settings</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
