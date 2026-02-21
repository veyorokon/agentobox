"use client"

import { useCallback } from "react"
import { useMutation } from "@apollo/client"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/stores/auth"
import { LOGIN_MUTATION } from "@/lib/graphql/mutations"

export function useAuth() {
  const router = useRouter()
  const { token, user, setAuth, logout: storeLogout } = useAuthStore()
  const [loginMutation, { loading, error }] = useMutation(LOGIN_MUTATION)

  const login = useCallback(
    async (username: string, password: string) => {
      const { data } = await loginMutation({
        variables: { input: { username, password } },
      })
      if (data?.login) {
        setAuth(data.login.token, data.login.user)
        router.push("/")
      }
    },
    [loginMutation, setAuth, router]
  )

  const logout = useCallback(() => {
    storeLogout()
    router.push("/login")
  }, [storeLogout, router])

  return {
    token,
    user,
    isAuthenticated: !!token,
    login,
    logout,
    loading,
    error,
  }
}
