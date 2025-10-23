'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Bell, Mail, MessageSquare, AlertCircle } from 'lucide-react'
import { useState } from 'react'

export default function NotificationsPage() {
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(false)
  const [workspaceUpdates, setWorkspaceUpdates] = useState(true)
  const [securityAlerts, setSecurityAlerts] = useState(true)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              Notification Preferences
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Manage how you receive updates and alerts
            </p>
          </div>

          <div className="grid gap-6 max-w-4xl">
            {/* Notification Channels */}
            <Card>
              <CardHeader>
                <CardTitle>Notification Channels</CardTitle>
                <CardDescription>
                  Choose how you want to receive notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-gray-500" />
                    <div>
                      <Label htmlFor="email-notifications" className="text-base font-medium cursor-pointer">
                        Email Notifications
                      </Label>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Receive updates via email
                      </p>
                    </div>
                  </div>
                  <button
                    id="email-notifications"
                    onClick={() => setEmailNotifications(!emailNotifications)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      emailNotifications ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        emailNotifications ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bell className="h-5 w-5 text-gray-500" />
                    <div>
                      <Label htmlFor="push-notifications" className="text-base font-medium cursor-pointer">
                        Push Notifications
                      </Label>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Receive browser push notifications
                      </p>
                    </div>
                  </div>
                  <button
                    id="push-notifications"
                    onClick={() => setPushNotifications(!pushNotifications)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      pushNotifications ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        pushNotifications ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Notification Types */}
            <Card>
              <CardHeader>
                <CardTitle>Notification Types</CardTitle>
                <CardDescription>
                  Select which types of notifications you want to receive
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-gray-500" />
                    <div>
                      <Label htmlFor="workspace-updates" className="text-base font-medium cursor-pointer">
                        Workspace Updates
                      </Label>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        New content, members, and changes
                      </p>
                    </div>
                  </div>
                  <button
                    id="workspace-updates"
                    onClick={() => setWorkspaceUpdates(!workspaceUpdates)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      workspaceUpdates ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        workspaceUpdates ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-gray-500" />
                    <div>
                      <Label htmlFor="security-alerts" className="text-base font-medium cursor-pointer">
                        Security Alerts
                      </Label>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Important security updates
                      </p>
                    </div>
                  </div>
                  <button
                    id="security-alerts"
                    onClick={() => setSecurityAlerts(!securityAlerts)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      securityAlerts ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        securityAlerts ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Email Digest */}
            <Card>
              <CardHeader>
                <CardTitle>Email Digest</CardTitle>
                <CardDescription>
                  Receive a summary of your notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Digest Frequency</Label>
                  <select className="w-full p-2 border rounded-md dark:bg-gray-800">
                    <option>Never</option>
                    <option>Daily</option>
                    <option>Weekly</option>
                    <option>Monthly</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>Preferred Time</Label>
                  <select className="w-full p-2 border rounded-md dark:bg-gray-800">
                    <option>9:00 AM</option>
                    <option>12:00 PM</option>
                    <option>6:00 PM</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Save Button */}
            <div className="flex gap-4">
              <Button>Save Preferences</Button>
              <Button variant="outline">Reset to Defaults</Button>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
