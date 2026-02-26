import type { Metadata } from "next"
import { GraphQLProvider } from "@/lib/graphql/provider"
import "./globals.css"

export const metadata: Metadata = {
  title: "Agentobox",
  description: "Agent orchestration dashboard",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-theme="claude" data-mode="dark">
      <body className="font-ui">
        <GraphQLProvider>{children}</GraphQLProvider>
      </body>
    </html>
  )
}
