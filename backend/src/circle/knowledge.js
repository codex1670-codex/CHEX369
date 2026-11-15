// Circle to Ask — the "Knowledge" layer: short, curated notes about what CHEX actually does and where to find it.
// Kept deliberately small and factual (taken from the README), so answers about the app stay grounded instead of
// guessed. `retrieve()` is a plain keyword scorer — no embeddings or extra services needed.

export const SCREENS = {
  feed: 'Home', search: 'Search', reels: 'Reels', messages: 'Messages', notifications: 'Notifications',
  games: 'Games', profile: 'Profile', settings: 'Settings', 'saved-posts': 'Saved posts', 'saved-reels': 'Saved reels',
  'reels-history': 'Reels history', 'profile-studio': 'Profile Studio', stickies: 'Sticky notes', mylife: 'Private space',
  learn: 'CHEX Learn', sim3d: 'CHEX Simulation', coins: 'Coin store',
};

const K = (id, screen, title, keywords, text) => ({ id, screen, title, keywords, text });

export const KNOWLEDGE = [
  K('feed', 'feed', 'Home feed', 'home feed post posts like comment share story stories notes for you following',
    'Home shows posts from people you follow plus an engagement-ranked "For You" feed. You can like, comment, share and save posts, and view 24-hour Stories and Notes at the top.'),
  K('stories', 'feed', 'Stories and Notes', 'story stories note notes 24 hour expire audience highlight archive',
    'Stories and Notes last 24 hours. You choose the audience. Stories can be text, a photo or a video; highlights keep stories permanently on your profile.'),
  K('messages', 'messages', 'Messages', 'message messages chat dm group request accept react edit delete pin forward theme',
    'Messages supports one-to-one and group chats. New senders arrive as message requests (Accept, Delete, Block or Report). You can react, edit, delete, pin and forward messages.'),
  K('calls', 'messages', 'Voice and video calls', 'call calls voice video ring mute camera webrtc missed',
    'Calls are started from a conversation. They ring for 45 seconds, then show as missed. You can mute, turn the camera off or flip it.'),
  K('reels', 'reels', 'Reels', 'reel reels video watch history saved',
    'Reels are short videos. You can save reels and see the reels you have watched in Reels history on your profile.'),
  K('games', 'games', 'Games', 'game games play online room code invite tournament chess ludo score duel',
    'The Game Store has 24 browser games plus online play: create a room, share the 6-character code or link, and play on separate devices. Tabs include Discover, 2 Players, Friends, Mine and Tournaments.'),
  K('profile', 'profile', 'Profile and Profile Studio', 'profile bio photo video studio edit followers following relationship mute restrict block close friends',
    'Your profile shows your posts, saved items and history. Profile Studio changes your photo, video (40 seconds max) and frame. The relationship menu on someone else\'s profile has mute, restrict, block and report.'),
  K('settings', 'settings', 'Settings', 'settings colour color theme appearance 2fa two factor floating ai circle deactivate delete account privacy blocked',
    'Settings holds appearance and colours, blocked/muted/restricted lists, two-factor authentication, the Floating AI bar, Circle to Ask, and account deactivation or deletion.'),
  K('account', 'settings', 'Deactivate vs delete account', 'deactivate delete account password permanent temporary',
    'Deactivating is temporary: log in again to reopen the same account. Deleting is permanent and needs your password, typing DELETE and a final confirmation.'),
  K('stickies', 'stickies', 'Sticky notes and reminders', 'sticky stickies reminder remind alarm note voice',
    'Sticky notes can be spoken-aloud reminders with a time. Ask Codex, for example "remind me at 5pm to call mom".'),
  K('learn', 'learn', 'CHEX Learn', 'learn course lesson language coins streak celebrate',
    'CHEX Learn is the lessons area. Completing lessons earns coins and keeps your progress in sync across devices.'),
  K('sim3d', 'sim3d', 'CHEX Simulation', 'simulation 3d scan studio model glb capture physics',
    'CHEX Simulation is the 3D area, including the 3D Scanning Studio for capturing and viewing models.'),
  K('coins', 'coins', 'Coin store', 'coin coins store gift buy balance',
    'The Coin store shows your coin balance and what coins can be used for, such as gifts.'),
  K('private', 'mylife', 'Private space', 'private space hidden second profile vault',
    'Private space is a separate, locked area of the app. Its content is never shared with Circle to Ask.'),
  K('codex', 'settings', 'Codex assistant', 'codex ai assistant voice floating bar command circle ask',
    'Codex is the built-in assistant. Type or speak commands such as "open reels" or "follow priya". The Floating AI bar (Settings) keeps it on every page. Circle to Ask lets you circle part of the screen and ask about it.'),
  K('search', 'search', 'Search', 'search find hashtag username people reels',
    'Search finds people, #hashtags and reels. An exact username opens that profile.'),
  K('notifications', 'notifications', 'Notifications', 'notification notifications alerts follow like mention invite',
    'Notifications lists likes, follows, mentions and game invites. Tapping an invite can join the game room directly.'),
];

const tokens = (s) => String(s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];

export function retrieve(query, screen, n = 3) {
  const q = new Set(tokens(query));
  const scored = KNOWLEDGE.map((e) => {
    let score = e.screen === screen ? 2 : 0;
    for (const t of tokens(`${e.title} ${e.keywords}`)) if (q.has(t)) score += 1;
    return { e, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, n);
  return scored.map((x) => x.e);
}
