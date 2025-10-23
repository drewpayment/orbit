import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import { CreditCard, Download, FileText } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

export default function BillingPage() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Billing & Subscription
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Manage your subscription and payment methods
            </p>
          </div>

          <div className="grid gap-6 max-w-4xl">
            {/* Current Plan */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Current Plan</CardTitle>
                    <CardDescription>You are currently on the Free plan</CardDescription>
                  </div>
                  <Badge variant="secondary">Free</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="font-medium">Monthly Price</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">Billed monthly</p>
                  </div>
                  <p className="text-2xl font-bold">$0</p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <h4 className="font-semibold">Plan Includes:</h4>
                  <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                    <li>• Up to 3 workspaces</li>
                    <li>• Basic documentation</li>
                    <li>• Community support</li>
                  </ul>
                </div>

                <Button asChild className="w-full">
                  <Link href="/upgrade">Upgrade Plan</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Payment Method */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Method</CardTitle>
                <CardDescription>
                  Manage your payment methods
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 p-4 border rounded-lg">
                  <CreditCard className="h-8 w-8 text-gray-400" />
                  <div className="flex-1">
                    <p className="font-medium">No payment method on file</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Add a payment method to upgrade your plan
                    </p>
                  </div>
                </div>

                <Button variant="outline" className="w-full">
                  Add Payment Method
                </Button>
              </CardContent>
            </Card>

            {/* Billing History */}
            <Card>
              <CardHeader>
                <CardTitle>Billing History</CardTitle>
                <CardDescription>
                  View and download your invoices
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p>No billing history yet</p>
                  <p className="text-sm mt-1">Your invoices will appear here</p>
                </div>
              </CardContent>
            </Card>

            {/* Usage */}
            <Card>
              <CardHeader>
                <CardTitle>Current Usage</CardTitle>
                <CardDescription>
                  Track your current plan usage
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Workspaces</span>
                    <span className="font-medium">0 / 3</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: '0%' }}></div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Team Members</span>
                    <span className="font-medium">1 / 5</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: '20%' }}></div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Storage</span>
                    <span className="font-medium">0 MB / 1 GB</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: '0%' }}></div>
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
