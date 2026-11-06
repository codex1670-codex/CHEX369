import type { Variants, Transition } from 'framer-motion';

/** One spring + one easing curve, so every animation in the app feels like the same product. */
export const spring: Transition = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 };
export const ease: Transition = { duration: 0.28, ease: [0.22, 1, 0.36, 1] };

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 14, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1, transition: ease },
};

export const sheetVariants: Variants = {
  hidden: { y: '100%', opacity: 0.6 },
  visible: { y: 0, opacity: 1, transition: spring },
  exit: { y: '100%', opacity: 0, transition: { duration: 0.2 } },
};

export const listStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: ease },
};

export const tap = { scale: 0.96 } as const;
