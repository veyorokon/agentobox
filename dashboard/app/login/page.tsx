"use client"

import { useState, useEffect, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const { login, loading, error, isAuthenticated } = useAuth()

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/")
    }
  }, [isAuthenticated, router])

  if (isAuthenticated) {
    return null
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    await login(username, password)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-default">Agentobox</h1>
          <p className="text-sm text-muted mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-xs font-medium text-secondary mb-1.5"
            >
              Username
            </label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium text-secondary mb-1.5"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-danger">
              {error.message || "Login failed"}
            </p>
          )}

          <Button
            type="submit"
            variant="accent"
            size="md"
            className="w-full"
            disabled={loading || !username || !password}
          >
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  )
}
