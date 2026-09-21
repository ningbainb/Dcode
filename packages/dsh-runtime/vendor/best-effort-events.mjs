export function runBestEffort(action, onError = () => {}) {
  if (typeof action !== 'function') throw new TypeError('action must be a function')
  if (typeof onError !== 'function') throw new TypeError('onError must be a function')
  const report = (error) => {
    try {
      const reported = onError(error)
      if (reported && typeof reported.then === 'function') {
        void Promise.resolve(reported).catch(() => {})
      }
    } catch {
      // Action diagnostics are best-effort and never own the caller lifecycle.
    }
  }
  try {
    const result = action()
    if (result && typeof result.then === 'function') {
      void Promise.resolve(result).catch(report)
    }
  } catch (error) {
    report(error)
  }
}

export function emitBestEffort(emitter, eventName, args, onError = () => {}) {
  if (!emitter || typeof emitter.rawListeners !== 'function') {
    throw new TypeError('emitter must expose rawListeners')
  }
  if (!Array.isArray(args)) throw new TypeError('event arguments must be an array')
  if (typeof onError !== 'function') throw new TypeError('onError must be a function')
  if (emitter.listenerCount(eventName) === 0) return false

  const report = (error) => {
    try {
      const reported = onError(error, eventName)
      if (reported && typeof reported.then === 'function') {
        void Promise.resolve(reported).catch(() => {})
      }
    } catch {
      // Observation and diagnostic failures never own the producer lifecycle.
    }
  }
  const listeners = emitter.rawListeners(eventName)
  for (const listener of listeners) {
    try {
      const delivered = Reflect.apply(listener, emitter, args)
      if (delivered && typeof delivered.then === 'function') {
        void Promise.resolve(delivered).catch(report)
      }
    } catch (error) {
      report(error)
    }
  }
  return listeners.length > 0
}
