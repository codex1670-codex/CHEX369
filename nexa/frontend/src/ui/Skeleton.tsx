import { motion } from 'framer-motion';

interface Props { lines?: number; className?: string; label?: string }

/** Shimmering placeholder shown while a screen loads. Styled with Tailwind, entrance via Framer Motion. */
export default function Skeleton({ lines = 3, className = '', label = 'Loading' }: Props) {
  return (
    <motion.div
      role="status"
      aria-label={label}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`glass-card tw-flex tw-flex-col tw-gap-3 tw-p-5 ${className}`}
    >
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="tw-relative tw-h-4 tw-overflow-hidden tw-rounded-full tw-bg-gold-100/60 dark:tw-bg-white/10"
          style={{ width: `${92 - i * 14}%` }}
        >
          <div className="tw-absolute tw-inset-0 tw--translate-x-full tw-animate-shimmer tw-bg-gradient-to-r tw-from-transparent tw-via-white/50 tw-to-transparent" />
        </div>
      ))}
    </motion.div>
  );
}
