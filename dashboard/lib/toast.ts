/**
 * Simple toast notification system
 * Uses a singleton pattern to manage toast state
 */

export type ToastType = "success" | "error" | "info" | "warning"

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
}

type ToastListener = (toasts: ToastMessage[]) => void

class ToastManager {
  private toasts: ToastMessage[] = []
  private listeners: Set<ToastListener> = new Set()
  private nextId = 0

  subscribe(listener: ToastListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.listeners.forEach(listener => listener([...this.toasts]))
  }

  show(message: string, type: ToastType = "info", duration = 3000) {
    const id = `toast-${this.nextId++}`
    const toast: ToastMessage = { id, type, message, duration }

    this.toasts.push(toast)
    this.notify()

    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration)
    }

    return id
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter(t => t.id !== id)
    this.notify()
  }

  success(message: string, duration?: number) {
    return this.show(message, "success", duration)
  }

  error(message: string, duration?: number) {
    return this.show(message, "error", duration)
  }

  info(message: string, duration?: number) {
    return this.show(message, "info", duration)
  }

  warning(message: string, duration?: number) {
    return this.show(message, "warning", duration)
  }
}

export const toast = new ToastManager()
