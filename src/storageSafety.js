// Mio startup safety for optional browser preferences.
//
// Chrome throws QuotaExceededError from localStorage.setItem() when the origin's
// storage quota is full. Most Mio persistence paths already handle storage
// failures, but the V259 snapshot invoice-marker preference writes directly to
// localStorage from a React effect. That optional preference must never be able
// to take down the entire application.

const OPTIONAL_LOCAL_STORAGE_KEYS = new Set([
  'caseMioSnapshotGraphShowInvoicesV259',
])

function isQuotaExceededError(error) {
  return Boolean(
    error && (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    )
  )
}

if (typeof window !== 'undefined' && typeof Storage !== 'undefined') {
  const storagePrototype = Storage.prototype

  if (!storagePrototype.__caseMioOptionalQuotaGuardInstalled) {
    const originalSetItem = storagePrototype.setItem

    Object.defineProperty(storagePrototype, '__caseMioOptionalQuotaGuardInstalled', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    })

    storagePrototype.setItem = function caseMioSafeSetItem(key, value) {
      try {
        return originalSetItem.call(this, key, value)
      } catch (error) {
        const isOptionalMioPreference =
          this === window.localStorage &&
          OPTIONAL_LOCAL_STORAGE_KEYS.has(String(key))

        if (isOptionalMioPreference && isQuotaExceededError(error)) {
          console.warn(
            `[Mio storage] Browser storage is full; skipped optional preference "${String(key)}" so Mio can continue running.`,
          )
          return undefined
        }

        throw error
      }
    }
  }
}
