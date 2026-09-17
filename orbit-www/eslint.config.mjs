import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          ignoreRestSiblings: false,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^(_|ignore)',
        },
      ],
    },
  },
  // Authz consolidation (docs/plans/2026-09-16-authz-consolidation.md, Phase A).
  // Feature code obtains identity via `getActor()` / `requireActor()` from
  // `@/lib/authz` and must not read the session or query workspace membership
  // directly. Warnings for now; flipped to errors in Phase D once the
  // remaining call sites are migrated (Phase C).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/lib/authz/**',
      'src/lib/auth/**',
      'src/lib/auth.ts',
      'src/lib/access/**',
      'src/lib/workspaces/members.ts',
      'src/lib/payload-better-auth-strategy.ts',
      'src/collections/WorkspaceMembers.ts',
      'src/app/api/auth/**',
      'src/**/*.test.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: '@/lib/auth/session',
              importNames: ['getCurrentUser', 'getPayloadUserFromSession', 'getSession'],
              message:
                'Use getActor()/requireActor() or authorize() from @/lib/authz. Actor exposes payloadId and betterAuthId by name; a bare session .id is ambiguous.',
            },
            {
              name: '@/lib/auth',
              importNames: ['auth'],
              message:
                'Do not read the session directly in feature code. Use getActor()/requireActor() from @/lib/authz.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'warn',
        {
          selector: "Property[key.name='collection'] Literal[value='workspace-members']",
          message:
            'Do not query workspace-members directly. Authorization: authorize()/check()/memberWorkspaceIds()/workspaceRole() from @/lib/authz. Roster data: @/lib/workspaces/members.',
        },
      ],
    },
  },
  {
    ignores: ['.next/'],
  },
]

export default eslintConfig
