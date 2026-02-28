import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { jwt } from "better-auth/plugins"
import { oauthProvider } from "@better-auth/oauth-provider"
import { mongodbAdapter } from "better-auth/adapters/mongodb"
import { MongoClient, ObjectId } from "mongodb"
import { getEnv } from "./env"

const client = new MongoClient(process.env.DATABASE_URI || "")

const appUrl = getEnv('NEXT_PUBLIC_APP_URL') || "http://localhost:3000"

export const auth = betterAuth({
  database: mongodbAdapter(client.db()),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Handled manually in databaseHooks for gated users only
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { Resend } = await import("resend")
      const resend = new Resend(process.env.RESEND_API_KEY)
      const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@hoytlabs.app"

      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: "Verify your Orbit account",
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Verify your email address</h2>
            <p>Your Orbit account has been approved! Click the link below to verify your email and start using Orbit.</p>
            <p style="margin: 24px 0;">
              <a href="${url}" style="display: inline-block; background: #FF5C00; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                Verify Email
              </a>
            </p>
            <p style="color: #666; font-size: 14px;">If you didn't create an Orbit account, you can ignore this email.</p>
          </div>
        `,
      })
    },
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day session is updated)
    storeSessionInDatabase: true,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  user: {
    additionalFields: {
      name: {
        type: "string",
        required: false,
      },
      avatar: {
        type: "string",
        required: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "pending",
        input: false,
      },
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const db = client.db()
          const user = await db.collection("user").findOne({ _id: new ObjectId(session.userId) })
          if (!user) {
            throw new APIError("UNAUTHORIZED", { message: "User not found" })
          }

          // Users created before admin-gated registration have no status field — allow them through
          const status = user.status
          if (!status) return
          if (status === "pending") {
            throw new APIError("FORBIDDEN", {
              message: "Your registration is pending admin approval.",
            })
          }
          if (status === "rejected") {
            throw new APIError("FORBIDDEN", {
              message: "Your registration was not approved. Contact an administrator.",
            })
          }
          if (status === "approved" && !user.emailVerified && user.role !== "super_admin") {
            throw new APIError("FORBIDDEN", {
              message: "Please verify your email before logging in. Check your inbox.",
            })
          }
        },
      },
    },
  },
  baseURL: appUrl,
  trustedOrigins: [
    appUrl,
    "http://localhost:3000",
  ],
  disabledPaths: ["/token"],
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/sign-in",
      accessTokenExpiresIn: 60 * 60, // 1 hour
      idTokenExpiresIn: 60 * 60 * 10, // 10 hours
      refreshTokenExpiresIn: 60 * 60 * 24 * 30, // 30 days
      scopes: ["openid", "profile", "email"],
      allowDynamicClientRegistration: true,
      customIdTokenClaims: ({ user }) => ({
        role: (user as Record<string, unknown>).role || "user",
      }),
      customUserInfoClaims: ({ user }) => ({
        role: (user as Record<string, unknown>).role || "user",
      }),
    }),
  ],
})

export type Session = typeof auth.$Infer.Session
export type User = Session['user']
