import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 },
      )
    }

    // 1. Create Better Auth user with status: pending (set by defaultValue)
    const signUpResponse = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: name || '',
      },
    })

    if (!signUpResponse) {
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 500 },
      )
    }

    // 2. Create matching Payload user record with status: pending
    try {
      const payload = await getPayload({ config })
      await payload.create({
        collection: 'users',
        data: {
          email,
          password,
          name: name || '',
          status: 'pending',
        } as any,
        overrideAccess: true,
      })
    } catch (payloadError) {
      // Log but don't fail — Better Auth user was created successfully
      console.error('[register] Failed to create Payload user record:', payloadError)
    }

    return NextResponse.json({
      success: true,
      message: 'Registration submitted. An admin will review your request.',
    })
  } catch (error: any) {
    console.error('[register] Registration error:', error)

    if (error?.message?.includes('already exists') || error?.status === 422) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}
