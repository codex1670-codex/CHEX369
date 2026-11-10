import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { notifyMasterOfReport, isMaster } from '../admin.js';

const router = Router();
const VALID_TYPES = ['post', 'comment', 'reel', 'reel_comment', 'story', 'note', 'user', 'message'];

router.post('/', requireAuth, (req, res) => {
  const { targetType, targetId, reason } = req.body || {};
  if (!VALID_TYPES.includes(targetType) || typeof targetId !== 'string' || !targetId) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Provide a valid targetType and targetId.' } });
  }
  const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : 'No reason provided.';
  const id = uuid();
  db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.userId, targetType, targetId, cleanReason);
  notifyMasterOfReport(id, req.app.get('io'));   // lands in sanjiv's DM inbox
  res.status(201).json({ ok: true, reportId: id, message: "Thanks — we've logged this report." });
});

// The moderation queue is for the master account only (full tools live under /api/admin).
const masterOnly = (req, res, next) => (isMaster(req.userId) ? next() : res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only the master account can review reports.' } }));
router.get('/', requireAuth, masterOnly, (req, res) => {
  const status = ['open', 'reviewing', 'actioned', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
  const rows = db.prepare('SELECT * FROM reports WHERE status = ? ORDER BY created_at DESC LIMIT 100').all(status);
  res.json({ reports: rows });
});

router.post('/:id/resolve', requireAuth, masterOnly, (req, res) => {
  const { status } = req.body || {};
  if (!['actioned', 'dismissed', 'reviewing'].includes(status)) {
    return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'status must be actioned, dismissed, or reviewing.' } });
  }
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not found.' } });
  db.prepare("UPDATE reports SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, row.id);
  res.json({ ok: true });
});

export default router;
