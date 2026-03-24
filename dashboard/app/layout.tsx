import type { CSSProperties } from "react"
import type { Metadata } from "next"
import { GraphQLProvider } from "@/lib/graphql/provider"
import { ThemeProvider } from "@/components/theme-provider"
import { ToastContainer } from "@/components/ui/toast-container"
import { buildThemeInitScript, buildThemeStyleObject, DEFAULT_THEME } from "@/lib/theme-registry"
import "@xterm/xterm/css/xterm.css"
import "./globals.css"

export const metadata: Metadata = {
  title: "Agentobox",
  description: "Agent orchestration dashboard",
}

const THEME_INIT_SCRIPT = buildThemeInitScript()
const DEFAULT_THEME_STYLE = buildThemeStyleObject(DEFAULT_THEME.tokens)

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME.id}
      data-mode={DEFAULT_THEME.mode}
      style={DEFAULT_THEME_STYLE as CSSProperties}
      suppressHydrationWarning
    >
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
