// Per-player views of a game's state. `state.secret` is never sent to anyone; a game may add a
// `VIEWS` entry to reveal part of its secret to ONE player only (e.g. your own hand of cards).
export const VIEWS = {
  'crazy-eights': (pub, secret, viewer) => ({ ...pub, hand: (secret.hands && secret.hands[viewer]) || [] }),
};
export function viewState(raw, gameId, viewerId) {
  const { secret, ...pub } = JSON.parse(raw || '{}');
  const v = VIEWS[gameId];
  return v ? v(pub, secret || {}, viewerId) : pub;
}
