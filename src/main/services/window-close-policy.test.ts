import { it, expect } from 'vitest'
import { shouldMinimizeOnClose } from './window-close-policy'

it('minimizes ordinary window closes but never intercepts explicit quit or update restart', () => {
  expect(shouldMinimizeOnClose(true, false)).toBe(true)
  expect(shouldMinimizeOnClose(true, true)).toBe(false)
  expect(shouldMinimizeOnClose(false, false)).toBe(false)
  expect(shouldMinimizeOnClose(false, true)).toBe(false)
})
