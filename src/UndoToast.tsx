import { useEffect, useState, type ReactElement } from 'react'

export type Undoable = { message: string; undo: () => void }

const TOAST_MS = 5_000

/**
 * A toast that offers to undo what was just done, for five seconds. Returns
 * the toast to render (null when there is none) and a function to show one;
 * a new one replaces the old.
 */
export function useUndoToast(): [ReactElement | null, (undoable: Undoable) => void] {
  const [shown, setShown] = useState<Undoable | null>(null)

  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [shown])

  const toast = shown && (
    <div className="toast" role="status">
      <span>{shown.message}</span>
      <button
        onClick={() => {
          shown.undo()
          setShown(null)
        }}
      >
        Undo
      </button>
    </div>
  )
  return [toast, setShown]
}
