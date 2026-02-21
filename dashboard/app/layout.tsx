import type { Metadata } from "next"
import { Providers } from "@/components/providers"
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
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
