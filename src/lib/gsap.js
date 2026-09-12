import { gsap } from 'gsap'

gsap.defaults({ duration: 0.5, ease: 'power3.out', overwrite: 'auto' })

const mediaQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

export const prefersReducedMotion = () => mediaQuery?.matches ?? false

export { gsap }
