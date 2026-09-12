import { onMounted, onUnmounted } from 'vue'
import { gsap, prefersReducedMotion } from '../lib/gsap.js'

/**
 * Run GSAP entrance/motion setup scoped to the component, with
 * prefers-reduced-motion respect and automatic cleanup on unmount.
 * Only transforms / autoAlpha should be animated; never the tile pane.
 *
 * @param {(gsap: typeof import('gsap').gsap, scope: Element | undefined) => void} setup
 * @param {import('vue').Ref<Element | null>} [scopeRef]
 */
export function useReveal(setup, scopeRef) {
  let ctx = null
  onMounted(() => {
    if (prefersReducedMotion()) return
    ctx = gsap.context(() => {
      gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
        setup(gsap, scopeRef?.value ?? undefined)
      })
    }, scopeRef?.value ?? undefined)
  })
  onUnmounted(() => {
    ctx?.revert()
    ctx = null
  })
}
