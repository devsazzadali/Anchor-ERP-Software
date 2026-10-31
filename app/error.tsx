'use client' // Error components must be Client Components

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-white">
      <div className="bg-slate-900/[0.05] backdrop-blur-xl border border-slate-900/10 rounded-3xl p-8 max-w-md w-full shadow-[0_0_50px_rgba(255,50,50,0.05)]">
        <h2 className="text-2xl font-bold text-slate-900 font-serif mb-4">Something went wrong!</h2>
        <p className="text-sm text-slate-500 mb-8">
          We've encountered an unexpected error. Our team has been notified.
        </p>
        <button
          className="bg-slate-900/[0.07] hover:bg-slate-900/[0.09] text-slate-900 font-bold py-3 px-6 rounded-xl text-sm transition-colors"
          onClick={
            // Attempt to recover by trying to re-render the segment
            () => reset()
          }
        >
          Try again
        </button>
      </div>
    </div>
  )
}
