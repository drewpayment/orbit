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
    // Signups start as status:pending, and the session.create gate rejects
    // pending users — creating a session at signup would make registration
    // itself fail with FORBIDDEN. New users sign in after approval instead.
    autoSignIn: false,
    // Keep the default resetPasswordTokenExpiresIn (1 hour).
    // Completing an emailed reset/invite link proves mailbox ownership, so mark
    // the account verified. For an admin-created invite this is what flips the
    // user from unverified→verified once they set their first password; for an
    // ordinary reset the flag is already true, so this is idempotent.
    onPasswordReset: async ({ user }) => {
      try {
        await client
          .db()
          .collection("user")
          .updateOne({ _id: new ObjectId(user.id) }, { $set: { emailVerified: true } })
      } catch (error) {
        console.error(`[password-reset] Failed to mark ${user.email} verified:`, error)
      }
    },
    sendResetPassword: async ({ user, url }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`\n${"=".repeat(60)}`)
        console.log(`📧 PASSWORD RESET (dev mode)`)
        console.log(`   To: ${user.email}`)
        console.log(`   URL: ${url}`)
        console.log(`${"=".repeat(60)}\n`)
      }

      if (!process.env.RESEND_API_KEY) {
        if (process.env.NODE_ENV === "development") {
          console.log(`   (No RESEND_API_KEY — skipping email send in dev mode)`)
        } else if (process.env.NODE_ENV === "production") {
          console.error(
            `[password-reset] RESEND_API_KEY not configured — password reset email NOT sent to ${user.email}`,
          )
        }
        return
      }

      const { Resend } = await import("resend")
      const resend = new Resend(process.env.RESEND_API_KEY)
      const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@hoytlabs.app"

      await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: "Reset your Orbit password",
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Reset your password</h2>
            <p>We received a request to reset the password for your Orbit account. Click the link below to choose a new password.</p>
            <p style="margin: 24px 0;">
              <a href="${url}" style="display: inline-block; background: #FF5C00; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                Reset Password
              </a>
            </p>
            <p style="color: #666; font-size: 14px;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
          </div>
        `,
      })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.NODE_ENV === "development") {
        console.log(`\n${"=".repeat(60)}`)
        console.log(`📧 EMAIL VERIFICATION (dev mode)`)
        console.log(`   To: ${user.email}`)
        console.log(`   URL: ${url}`)
        console.log(`${"=".repeat(60)}\n`)
      }

      if (!process.env.RESEND_API_KEY) {
        if (process.env.NODE_ENV === "development") {
          console.log(`   (No RESEND_API_KEY — skipping email send in dev mode)`)
        } else if (process.env.NODE_ENV === "production") {
          console.error(
            `[email-verification] RESEND_API_KEY not configured — verification email NOT sent to ${user.email}`,
          )
        }
        return
      }

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
    // Cookie cache intentionally DISABLED. When enabled it serves the signed
    // session cookie (user + status) for up to maxAge WITHOUT a DB read, so a
    // deactivated/revoked user keeps passing every getSession-based gate — the
    // ~40 raw auth.api.getSession call sites (server data loaders and client
    // useSession via /api/auth/get-session included) — until the cache expires.
    // Session revocation on deactivate must take effect on the next request
    // everywhere, so each getSession does one indexed DB lookup instead. See
    // docs/plans/2026-07-11-platform-user-management.md (UAC 20).
    cookieCache: {
      enabled: false,
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
          if (status === "deactivated") {
            throw new APIError("FORBIDDEN", {
              message: "Your account has been deactivated. Contact an administrator.",
            })
          }
          if (
            status === "approved" &&
            !user.emailVerified &&
            user.role !== "super_admin" &&
            user.role !== "admin"
          ) {
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
      silenceWarnings: { oauthAuthServerConfig: true },
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
