import { useState } from 'react';
import OrbitIcon from './OrbitIcon.jsx';
import {
  ALL_CARDS, RADIAL_ALL, RING_MIN, RING_MAX, RADIAL_MIN,
  defaultMenu, isDefaultMenu, moveId, removeId, addId,
} from './orbitStore.js';

// The "Customize menu" tab inside ORBIT.
//   Cards         – choose which modules sit on the ring and in what order (up/down), hide or add any CHEX module.
//   Quick actions – choose which actions the orb shows, and their order.
// Every change is saved straight away (this device only) and the ring updates behind the panel.
export default function OrbitCustomize({ menu, user, onChange, onClose }) {
  const [tab, setTab] = useState('cards');
  const cards = ALL_CARDS.filter(c => !c.adminOnly || user?.isAdmin);
  const byId = new Map(cards.map(c => [c.id, c]));
  const radialById = new Map(RADIAL_ALL.map(c => [c.id, c]));

  const isCards = tab === 'cards';
  const list = isCards ? menu.ring.filter(id => byId.has(id)) : menu.radial;
  const min = isCards ? RING_MIN : RADIAL_MIN;
  const max = isCards ? RING_MAX : RADIAL_ALL.length;
  const lookup = isCards ? byId : radialById;
  const hiddenIds = (isCards ? cards : RADIAL_ALL).map(c => c.id).filter(id => !list.includes(id));
  const key = isCards ? 'ring' : 'radial';
  const set = (nextList) => onChange({ ...menu, [key]: nextList });
  const noun = isCards ? 'cards' : 'quick actions';

  return (
    <div className="ob-cu-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="ob-cu" role="region" aria-label="Customize menu" data-testid="orbit-customize">
        <header className="ob-cu-head">
          <span className="ob-medal sm"><OrbitIcon name="sliders" size={22} /></span>
          <div><h2>Customize menu</h2><p>Pick what Orbit shows and in what order.</p></div>
          <button type="button" className="ob-chip ob-x" onClick={onClose} aria-label="Close customize" autoFocus><OrbitIcon name="close" size={18} /></button>
        </header>

        <div className="ob-cu-tabs" role="tablist" aria-label="Customize">
          {[['cards', 'Cards'], ['quick', 'Quick actions']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`ob-cu-tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        <div className="ob-cu-body">
          <p className="ob-cu-count" data-testid="orbit-cu-count">{list.length} of {max} {noun} shown{list.length <= min ? ` · keep at least ${min}` : ''}</p>
          <ul className="ob-cu-list" aria-label={`Shown ${noun}`}>
            {list.map((id, i) => {
              const it = lookup.get(id); if (!it) return null;
              return (
                <li key={id} className="ob-cu-row">
                  <span className="ob-cu-ico" style={it.hue != null ? { '--hue': it.hue } : undefined}><OrbitIcon name={it.icon} size={20} /></span>
                  <span className="ob-cu-name"><b>{it.label}</b>{it.hint && <span>{it.hint}</span>}</span>
                  <button type="button" className="ob-cu-btn" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => set(moveId(list, id, -1))}><OrbitIcon name="up" size={16} /></button>
                  <button type="button" className="ob-cu-btn" aria-label={`Move ${it.label} down`} disabled={i === list.length - 1} onClick={() => set(moveId(list, id, 1))}><OrbitIcon name="down" size={16} /></button>
                  <button type="button" className="ob-cu-btn rm" aria-label={`Hide ${it.label}`} disabled={list.length <= min} onClick={() => set(removeId(list, id, min))}><OrbitIcon name="minus" size={16} /></button>
                </li>
              );
            })}
          </ul>

          {hiddenIds.length > 0 && (
            <>
              <p className="ob-cu-sub">Hidden{isCards ? ' · tap + to add to the ring' : ''}</p>
              <ul className="ob-cu-list" aria-label={`Hidden ${noun}`}>
                {hiddenIds.map((id) => {
                  const it = lookup.get(id);
                  return (
                    <li key={id} className="ob-cu-row off">
                      <span className="ob-cu-ico" style={it.hue != null ? { '--hue': it.hue } : undefined}><OrbitIcon name={it.icon} size={20} /></span>
                      <span className="ob-cu-name"><b>{it.label}</b>{it.hint && <span>{it.hint}</span>}</span>
                      <button type="button" className="ob-cu-btn add" aria-label={`Add ${it.label}`} disabled={list.length >= max} onClick={() => set(addId(list, id, max))}><OrbitIcon name="plus" size={16} /></button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="ob-cu-foot">
          <button type="button" className="ob-chip" disabled={isDefaultMenu(menu)} onClick={() => onChange(defaultMenu())}><OrbitIcon name="reset" size={15} /><span>Reset to default</span></button>
          <button type="button" className="ob-chip ob-cu-done" onClick={onClose}><OrbitIcon name="check" size={15} /><span>Done</span></button>
        </footer>
      </section>
    </div>
  );
}
