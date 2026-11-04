import Learn from '../learn/Learn.jsx';

// CHEX learn as its own page, opened from the "＋" menu (it used to be a tab inside My life).
export default function LearnPage({ onBack, onOpenProfile }) {
  return (
    <div className="mylife-page" data-noswipe="">
      <div className="stickies-head">
        {onBack && <button className="btn-ghost" style={{ width: 'auto', padding: '7px 14px' }} onClick={onBack}>← Back</button>}
        <h2>🌍 CHEX learn</h2>
      </div>
      <p className="stickies-sub">Learn a language a little every day — your streak, XP and progress belong to your CHEX account.</p>
      <Learn onOpenProfile={onOpenProfile} />
    </div>
  );
}
