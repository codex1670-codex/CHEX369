import type { ComponentProps } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { pageVariants } from './variants';

type Props = ComponentProps<typeof motion.main> & { routeKey: string };

/**
 * The app's `<main>` column, animated: it fades/slides in whenever `routeKey` changes.
 * Enter-only on purpose — the old page unmounts immediately, so navigation never feels laggy and
 * state resets exactly as before. Honours the OS "reduce motion" setting.
 */
export default function PageTransition({ routeKey, children, ...rest }: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.main
      key={routeKey}
      variants={reduce ? undefined : pageVariants}
      initial={reduce ? false : 'initial'}
      animate="animate"
      {...rest}
    >
      {children}
    </motion.main>
  );
}
