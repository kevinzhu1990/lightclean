import type { LightCleanAPI } from '../../../preload/index'

declare global {
  interface Window {
    lightclean: LightCleanAPI
  }
}

export const api = window.lightclean
