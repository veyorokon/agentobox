/**
 * Theme picker persistence tests.
 *
 * Ensures the project theme written to the backend uses the selected
 * built-in theme identity, not a racy DOM computed-style snapshot.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"

const setProjectTheme = vi.fn(() => Promise.resolve({ data: { setProjectTheme: true } }))

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}))

vi.mock("@apollo/client/react", () => ({
  useMutation: () => [setProjectTheme],
}))

describe("theme picker", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.setAttribute("data-theme", "claude")
    document.documentElement.setAttribute("data-mode", "dark")
    setProjectTheme.mockReset()
  })

  it("sends the selected preset identity to the backend", async () => {
    const { ThemePicker } = await import("@/components/layout/theme-picker")
    render(React.createElement(ThemePicker))

    fireEvent.click(screen.getByTitle("Theme"))
    fireEvent.click(screen.getByRole("button", { name: /nord/i }))

    expect(setProjectTheme).toHaveBeenCalledWith({
      variables: {
        input: {
          projectId: "proj-1",
          theme: "nord",
          mode: "dark",
        },
      },
    })
  })
})
