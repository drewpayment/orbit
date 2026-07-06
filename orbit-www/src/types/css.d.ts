// Next.js 15's build-time type checker (TS 6) enforces resolvable side-effect
// imports (TS2882). Global stylesheet imports like `import '@/app/globals.css'`
// need an ambient module declaration; CSS modules keep their typed shape below.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.css'
declare module '*.scss'
// Payload's admin styles are exported under an extensionless specifier the
// wildcard patterns above don't match.
declare module '@payloadcms/next/css'
