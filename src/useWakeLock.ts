import { useEffect } from 'react'

/**
 * Keeps the screen on while the app is in the foreground: a phone that locks
 * every thirty seconds is the main annoyance of shopping lists. The browser
 * drops the lock when the app is hidden, so it is taken again on return.
 */
export function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | undefined
    let stopped = false
    const take = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((taken) => {
          if (stopped) void taken.release()
          else lock = taken
        })
        // Refused, e.g. in battery saver: the screen just locks as usual.
        .catch(() => {})
    }
    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', take)
      void lock?.release()
    }
  }, [])
}
