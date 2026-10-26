/**
 * Writes are never awaited: the promise resolves only when the server
 * confirms, which never happens offline. The local cache already has the
 * change, and the snapshot listeners show it at once.
 */
export function report(write: Promise<void>) {
  write.catch((e) => console.error('Write failed', e))
}

const RETRY_MS = 1_500

/**
 * Runs `listen` and, when it fails, runs it again a moment later. The rules
 * refuse a listener while a document it depends on has not reached the
 * server yet, such as a list just created, and a refused listener stops.
 */
export function keepListening(listen: (onError: () => void) => () => void): () => void {
  let stopped = false
  let stop = () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = () => {
    stop = listen(() => {
      if (!stopped) timer = setTimeout(start, RETRY_MS)
    })
  }
  start()
  return () => {
    stopped = true
    clearTimeout(timer)
    stop()
  }
}
