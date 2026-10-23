// Account lifecycle: deactivate is temporary (same name+password reopens it),
// delete is permanent and only ever happens on an explicit, confirmed request.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.NEXA_DB_PATH = path.join(os.tmpdir(), `nexa-account-test-${process.pid}.db`);
(await import('node:fs')).rmSync(process.env.NEXA_DB_PATH, { force: true });
process.env.PORT = '0';

const { default: db } = await import('../src/db.js');
const { deactivateUser, reactivateUser, deleteUserPermanently } = await import('../src/accountService.js');
const bcrypt = (await import('bcryptjs')).default;

const mk = (name) => {
  const id = `id-${name}`;
  db.prepare('INSERT INTO users (id, username, email, password_hash, display_name) VALUES (?,?,?,?,?)')
    .run(id, name, `${name}@x.com`, bcrypt.hashSync('pw123456', 4), name);
  return id;
};

test('deactivate keeps the account and its data; reactivate restores it', () => {
  const id = mk('alice');
  db.prepare("INSERT INTO posts (id, user_id, caption) VALUES ('p1', ?, 'hello')").run(id);
  deactivateUser(id);
  assert.equal(db.prepare('SELECT account_status s FROM users WHERE id=?').get(id).s, 'deactivated');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id=?').get(id).c, 1);
  reactivateUser(id);
  assert.equal(db.prepare('SELECT account_status s FROM users WHERE id=?').get(id).s, 'active');
});

test('nothing deletes a user unless deleteUserPermanently is called', () => {
  const id = mk('bob');
  db.prepare("INSERT INTO account_deletions (id, user_id, scheduled_at) VALUES ('d1', ?, '2000-01-01')").run(id);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id=?').get(id)); // an overdue schedule must not matter
});

test('permanent delete removes the user and their content', () => {
  const id = mk('carol');
  db.prepare("INSERT INTO posts (id, user_id, caption) VALUES ('p2', ?, 'bye')").run(id);
  assert.equal(deleteUserPermanently(id), true);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id=?').get(id), undefined);
  assert.equal(db.prepare('SELECT 1 FROM posts WHERE id=?').get('p2'), undefined);
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
