import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-cap-${process.pid}.db`);
const { default: db } = await import('../src/db.js');

test('only the newest 100 notifications per person are kept', () => {
  const ins = db.prepare("INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?, ?, ?, 'x', ?)");
  ins.run('a', 'cap_a', 'a@x.com', 'A'); ins.run('b', 'cap_b', 'b@x.com', 'B');
  const n = db.prepare("INSERT INTO notifications (id, recipient_id, actor_id, type, created_at) VALUES (?, ?, 'b', 'like', ?)");
  for (let i = 0; i < 130; i++) n.run(`n${i}`, 'a', new Date(1700000000000 + i * 1000).toISOString());
  n.run('other', 'b', new Date().toISOString());
  const rows = db.prepare("SELECT id FROM notifications WHERE recipient_id = 'a'").all();
  assert.equal(rows.length, 100);
  assert.ok(rows.some(r => r.id === 'n129'), 'newest kept');
  assert.ok(!rows.some(r => r.id === 'n0'), 'oldest removed');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE recipient_id = 'b'").get().c, 1, "other people's are untouched");
});
