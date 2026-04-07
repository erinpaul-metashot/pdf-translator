/**
 * Centralized abort controller for PDF conversion operations.
 * React re-renders + state updates require a shared signal management point.
 * This singleton ensures all conversion attempts can be cleanly cancelled.
 */

// Singleton AbortController instance for conversion operations
export const conversionAbortController = new AbortController();

/**
 * Reset the abort signal for the next conversion.
 * Should be called after a conversion completes (success or error) to enable future conversions.
 */
export function resetAbortSignal(): void {
  // Create a new AbortController to reset the signal
  // The old one cannot be reused once aborted
  Object.assign(conversionAbortController, new AbortController());
}
