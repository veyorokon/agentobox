import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { User } from "@/types"

interface AuthState {
  token: string | null
  user: User | null
  setAuth: (token: string, user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => {
        set({ token: null, user: null })
        // Clear Apollo cache and dispose WebSocket connection.
        // Dynamic import avoids circular dependency (client.ts reads
        // auth-storage from localStorage, auth.ts resets the client).
        import("@/lib/graphql/client").then(({ resetApolloClient }) => {
          resetApolloClient()
        })
      },
    }),
    { name: "auth-storage" }
  )
)
