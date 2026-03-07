import type { Metadata } from "next"
import { GraphQLProvider } from "@/lib/graphql/provider"
import { ThemeProvider } from "@/components/theme-provider"
import { ToastContainer } from "@/components/ui/toast-container"
import "./globals.css"

export const metadata: Metadata = {
  title: "Agentobox",
  description: "Agent orchestration dashboard",
}

/**
 * Inline script that runs BEFORE React hydrates to prevent theme flash.
 * Reads persisted theme from localStorage and sets data attributes on <html>.
 * If localStorage is empty or corrupt, claude/dark is the implicit fallback
 * (set as default attributes on the <html> tag).
 */
const THEME_INIT_SCRIPT = `
try {
  var t = JSON.parse(localStorage.getItem('abox-theme'));
  if (t && t.theme && t.mode) {
    document.documentElement.setAttribute('data-theme', t.theme);
    document.documentElement.setAttribute('data-mode', t.mode);
  }
} catch(e) {}
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-theme="claude" data-mode="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-ui">
        <ThemeProvider>
          <GraphQLProvider>
            {children}
            <ToastContainer />
          </GraphQLProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
