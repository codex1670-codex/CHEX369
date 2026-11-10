// The real CHEX coin (the CHEX logo, round), used everywhere CHEX learn shows a coin.
export default function CoinLogo({ size = 20, spin = false, className = '' }) {
  return <img src="/logo.png" width={size} height={size} alt="" aria-hidden="true" draggable="false" className={`learn-coinlogo${spin ? ' spin' : ''} ${className}`} style={{ width: size, height: size }} />;
}
