import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * of no further changes. Use to avoid firing one query per keystroke
 * in search inputs:
 *
 *   const [search, setSearch] = useState('')
 *   const debouncedSearch     = useDebounce(search, 300)
 *   // call the API with `debouncedSearch`, not `search`
 *
 * 300ms is the sweet spot for typed search — short enough to feel
 * responsive, long enough that a 4-letter query fires 1 request
 * instead of 4.
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
