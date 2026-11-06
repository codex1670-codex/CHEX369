import { v4 as uuid } from 'uuid';
import type { Server } from 'socket.io';
import db from './db.js';

const MENTION_RE = /@([a-z0-9_.]{3,20})/gi;
const HASHTAG_RE = /#([a-z0-9_]{1,50})/gi;

export type ContentSource = 'post' | 'comment' | 'reel' | 'story' | 'note';

interface ProcessArgs {
  text?: string | null;
  sourceType: ContentSource;
  sourceId: string;
  actorId: string;
  io?: Server | null;
}

/**
 * Extracts @mentions and #hashtags from text and records real, queryable rows for each —
 * mentions drive the 'mention' notification; hashtags are searchable. Unknown usernames
 * are silently skipped rather than erroring, since a caption can reference someone who
 * doesn't exist.
 */
export function processMentionsAndHashtags({ text, sourceType, sourceId, actorId, io }: ProcessArgs): void {
  if (!text) return;
  const mentionedUsernames = [...new Set([...text.matchAll(MENTION_RE)].map(m => (m[1] ?? '').toLowerCase()))];
  for (const username of mentionedUsernames) {
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined;
    if (!user || user.id === actorId) continue;
    db.prepare('INSERT INTO mentions (id, source_type, source_id, mentioned_user_id) VALUES (?, ?, ?, ?)')
      .run(uuid(), sourceType, sourceId, user.id);
    db.prepare("INSERT INTO notifications (id, recipient_id, actor_id, type, target_id) VALUES (?, ?, ?, 'mention', ?)")
      .run(uuid(), user.id, actorId, sourceId);
    io?.to(`user:${user.id}`).emit('notification:new', { type: 'mention' });
  }

  if (sourceType === 'post' || sourceType === 'reel') {
    const tags = [...new Set([...text.matchAll(HASHTAG_RE)].map(m => (m[1] ?? '').toLowerCase()))];
    // Table/column names come from this closed set, never from user input.
    const junctionTable = sourceType === 'post' ? 'post_hashtags' : 'reel_hashtags';
    const junctionCol = sourceType === 'post' ? 'post_id' : 'reel_id';
    for (const tag of tags) {
      let row = db.prepare('SELECT id FROM hashtags WHERE tag = ?').get(tag) as { id: string } | undefined;
      if (!row) {
        const id = uuid();
        db.prepare('INSERT INTO hashtags (id, tag) VALUES (?, ?)').run(id, tag);
        row = { id };
      }
      db.prepare(`INSERT OR IGNORE INTO ${junctionTable} (${junctionCol}, hashtag_id) VALUES (?, ?)`).run(sourceId, row.id);
    }
  }
}
