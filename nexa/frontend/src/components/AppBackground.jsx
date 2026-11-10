// Fixed full-screen background. Plain gradient normally; with a premium theme (see premium.css)
// the orbs, sheen and grain layers come alive. Pure CSS transforms, so it stays smooth on phones.
export default function AppBackground() {
  return (
    <div className="app-bg" aria-hidden="true">
      <i className="orb o1" /><i className="orb o2" /><i className="orb o3" />
      <i className="sheen" /><i className="grain" />
    </div>
  );
}
