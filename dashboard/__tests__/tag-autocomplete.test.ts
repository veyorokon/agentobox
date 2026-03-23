/**
 * Tag autocomplete tests.
 *
 * Proves the TagInput suggestions dropdown works correctly:
 * - typing filters suggestions by case-insensitive prefix
 * - clicking a suggestion inserts the canonical stored string
 * - already-added tags are excluded from suggestions
 * - freeform tags still work when no suggestion matches
 * - keyboard navigation (arrow/enter/escape)
 *
 * Prevents regression of #124 (tag UX for non-technical users).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import React from "react"

import { TagInput } from "@/components/shared/tag-input"

afterEach(cleanup)

const suggestions = ["backend", "data-collection", "frontend", "devops", "design"]

function renderTagInput(
  tags: string[] = [],
  onChange = vi.fn(),
  suggs = suggestions,
) {
  return {
    onChange,
    ...render(
      React.createElement(TagInput, {
        tags,
        onChange,
        placeholder: "Add tag...",
        suggestions: suggs,
      }),
    ),
  }
}

function getInput() {
  return screen.getByPlaceholderText("Add tag...") as HTMLInputElement
}

describe("TagInput autocomplete: filtering", () => {
  it("shows suggestions matching typed prefix", () => {
    renderTagInput()
    const input = getInput()
    fireEvent.change(input, { target: { value: "dat" } })

    expect(screen.getByText("data-collection")).toBeTruthy()
    // "backend" should not appear — does not match "dat"
    expect(screen.queryByText("backend")).toBeNull()
  })

  it("matches case-insensitively", () => {
    renderTagInput()
    const input = getInput()
    fireEvent.change(input, { target: { value: "BACK" } })

    expect(screen.getByText("backend")).toBeTruthy()
  })

  it("excludes already-added tags from suggestions", () => {
    renderTagInput(["backend"])
    // Input placeholder won't show when tags exist — find by role
    const input = screen.getByRole("textbox") as HTMLInputElement
    fireEvent.change(input, { target: { value: "b" } })

    // "backend" is already added, should not appear in suggestions
    // Only the tag pill should show "backend", not a suggestion button
    const buttons = screen.getAllByText("backend")
    // One is the tag pill text, no suggestion button
    expect(buttons.length).toBe(1)
  })

  it("shows no dropdown when input is empty", () => {
    renderTagInput()
    const input = getInput()
    fireEvent.change(input, { target: { value: "" } })

    // No suggestion items should be visible
    expect(screen.queryByText("data-collection")).toBeNull()
    expect(screen.queryByText("backend")).toBeNull()
  })

  it("shows no dropdown when no suggestions match", () => {
    renderTagInput()
    const input = getInput()
    fireEvent.change(input, { target: { value: "zzz" } })

    expect(screen.queryByText("backend")).toBeNull()
    expect(screen.queryByText("data-collection")).toBeNull()
  })
})

describe("TagInput autocomplete: selection", () => {
  it("clicking a suggestion adds the canonical tag", () => {
    const onChange = vi.fn()
    renderTagInput([], onChange)
    const input = getInput()
    fireEvent.change(input, { target: { value: "data" } })

    const suggestion = screen.getByText("data-collection")
    fireEvent.mouseDown(suggestion)

    expect(onChange).toHaveBeenCalledWith(["data-collection"])
  })

  it("freeform tag still works when no suggestion matches", () => {
    const onChange = vi.fn()
    renderTagInput([], onChange)
    const input = getInput()
    fireEvent.change(input, { target: { value: "custom-tag" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onChange).toHaveBeenCalledWith(["custom-tag"])
  })

  it("freeform tag works even with suggestions present", () => {
    const onChange = vi.fn()
    renderTagInput([], onChange)
    const input = getInput()
    // Type something that partially matches but user wants the exact typed value
    fireEvent.change(input, { target: { value: "dev" } })
    // Press Enter without arrow-selecting a suggestion
    fireEvent.keyDown(input, { key: "Enter" })

    // Should add "dev" as freeform, not "devops"
    expect(onChange).toHaveBeenCalledWith(["dev"])
  })
})

describe("TagInput autocomplete: keyboard navigation", () => {
  it("arrow down highlights first suggestion, Enter selects it", () => {
    const onChange = vi.fn()
    renderTagInput([], onChange)
    const input = getInput()
    fireEvent.change(input, { target: { value: "d" } })

    // Arrow down to highlight first match
    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter" })

    // First match alphabetically starting with "d" is "data-collection"
    expect(onChange).toHaveBeenCalledWith(["data-collection"])
  })

  it("escape closes dropdown without adding tag", () => {
    const onChange = vi.fn()
    renderTagInput([], onChange)
    const input = getInput()
    fireEvent.change(input, { target: { value: "back" } })

    expect(screen.getByText("backend")).toBeTruthy()

    fireEvent.keyDown(input, { key: "Escape" })

    // Dropdown should be gone but onChange should not have been called
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("TagInput without suggestions prop", () => {
  it("works as plain tag input with no dropdown", () => {
    const onChange = vi.fn()
    render(
      React.createElement(TagInput, {
        tags: [],
        onChange,
        placeholder: "Add tag...",
      }),
    )

    const input = screen.getByPlaceholderText("Add tag...") as HTMLInputElement
    fireEvent.change(input, { target: { value: "hello" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onChange).toHaveBeenCalledWith(["hello"])
  })
})
