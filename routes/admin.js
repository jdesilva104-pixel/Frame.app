const express = require('express');
const path = require('node:path');

module.exports = function createAdminRouter({ one, all, run, db, bcrypt, adminOnly, adminEmail, root, uploadRoot, removeUploadedFile }) {
  const router = express.Router();
  const adminLoginFailures = new Map();
  const logModeration = (adminId, targetType, targetId, action, details = '') =>
    run('INSERT INTO moderation_actions (admin_id, target_type, target_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      adminId, targetType, targetId, action, details, new Date().toISOString());

  router.get('/admin/login', (req, res) => {
    if (req.session.userId && one('SELECT id FROM users WHERE id = ? AND email = ? AND is_admin = 1 AND is_suspended = 0', req.session.userId, adminEmail)) {
      return res.redirect('/admin');
    }
    res.sendFile(path.join(root, 'public', 'admin-login.html'));
  });

  router.get('/admin', (req, res) => {
    if (!req.session.userId) return res.redirect('/admin/login');
    if (!one('SELECT id FROM users WHERE id = ? AND email = ? AND is_admin = 1 AND is_suspended = 0', req.session.userId, adminEmail)) {
      return res.redirect('/admin/login?error=admin-only');
    }
    res.sendFile(path.join(root, 'private', 'admin-dashboard.html'));
  });

  router.post('/api/admin/login', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = adminLoginFailures.get(ip);
    if (attempt?.blockedUntil > now) {
      res.set('Retry-After', String(Math.ceil((attempt.blockedUntil - now) / 1000)));
      return res.status(429).json({ error: 'Too many admin sign-in attempts. Try again in a few minutes.' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = email === adminEmail.toLowerCase()
      ? one('SELECT id, name, email, password_hash FROM users WHERE email = ? AND is_admin = 1 AND is_suspended = 0', adminEmail)
      : null;
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      const failures = attempt && now - attempt.lastAttemptAt < 15 * 60 * 1000 ? attempt.failures : 0;
      const next = failures + 1;
      adminLoginFailures.set(ip, { failures: next, blockedUntil: next >= 8 ? now + 15 * 60 * 1000 : 0, lastAttemptAt: now });
      if (adminLoginFailures.size > 5000) {
        for (const [key, value] of adminLoginFailures) if (now - value.lastAttemptAt > 30 * 60 * 1000) adminLoginFailures.delete(key);
      }
      return res.status(401).json({ error: 'Admin email or password is incorrect.' });
    }
    adminLoginFailures.delete(ip);
    req.session.regenerate(error => {
      if (error) return res.status(500).json({ error: 'Could not start an admin session.' });
      req.session.userId = user.id;
      run('UPDATE users SET last_active_at = ? WHERE id = ?', new Date().toISOString(), user.id);
      req.session.save(saveError => {
        if (saveError) return res.status(500).json({ error: 'Could not start an admin session.' });
        res.json({ user: { id: user.id, name: user.name, email: user.email } });
      });
    });
  });

  router.put('/api/admin/password', adminOnly, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || newPassword.length < 20) {
      return res.status(400).json({ error: 'Enter your current password and a new password of at least 20 characters.' });
    }
    const admin = one('SELECT id, password_hash FROM users WHERE id = ? AND email = ? AND is_admin = 1', req.session.userId, adminEmail);
    if (!admin || !(await bcrypt.compare(currentPassword, admin.password_hash))) {
      return res.status(400).json({ error: 'Your current admin password is incorrect.' });
    }
    if (await bcrypt.compare(newPassword, admin.password_hash)) {
      return res.status(400).json({ error: 'Choose a new password different from your current password.' });
    }
    try {
      run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(newPassword, 12), admin.id);
      res.json({ ok: true });
    } catch (error) {
      console.error('Admin password change error:', error);
      res.status(500).json({ error: 'Could not update the admin password.' });
    }
  });

  router.get('/api/admin/overview', adminOnly, (_req, res) => {
    const activeSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    res.json({
      users: one('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0').count,
      activeUsers: one('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0 AND is_suspended = 0 AND last_active_at >= ?', activeSince).count,
      videos: one('SELECT COUNT(*) AS count FROM videos').count,
      comments: one('SELECT COUNT(*) AS count FROM comments').count,
      suspended: one('SELECT COUNT(*) AS count FROM users WHERE is_suspended = 1').count,
      limited: one('SELECT COUNT(*) AS count FROM users WHERE is_limited = 1').count,
      openReports: one("SELECT COUNT(*) AS count FROM reports WHERE status IN ('open', 'reviewing')").count
    });
  });

  router.get('/api/admin/analytics', adminOnly, (req, res) => {
    const allowedDays = [7, 14, 30];
    const days = allowedDays.includes(Number(req.query.days)) ? Number(req.query.days) : 14;
    const series = all(`WITH RECURSIVE calendar(day) AS (
        SELECT date('now', ?)
        UNION ALL SELECT date(day, '+1 day') FROM calendar WHERE day < date('now')
      )
      SELECT calendar.day,
        (SELECT COUNT(*) FROM videos v WHERE date(v.created_at) = calendar.day) AS uploads,
        (SELECT COUNT(*) FROM comments c WHERE date(c.created_at) = calendar.day) AS comments,
        (SELECT COUNT(*) FROM moderation_actions m WHERE m.target_type = 'comment' AND m.action = 'deleted' AND date(m.created_at) = calendar.day) AS moderated_comments,
        (SELECT COUNT(*) FROM users u WHERE u.is_admin = 0 AND date(u.created_at) = calendar.day) AS new_users
      FROM calendar ORDER BY calendar.day`, `-${days - 1} days`);
    const activeSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    res.json({
      days,
      totals: {
        users: one('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0').count,
        activeUsers: one('SELECT COUNT(*) AS count FROM users WHERE is_admin = 0 AND is_suspended = 0 AND last_active_at >= ?', activeSince).count,
        uploads: one('SELECT COUNT(*) AS count FROM videos').count,
        comments: one('SELECT COUNT(*) AS count FROM comments').count,
        commentsToday: one("SELECT COUNT(*) AS count FROM comments WHERE date(created_at) = date('now')").count,
        commentsReported: one("SELECT COUNT(*) AS count FROM reports WHERE target_type = 'comment' AND status IN ('open', 'reviewing')").count,
        commentsRemoved: one("SELECT COUNT(*) AS count FROM moderation_actions WHERE target_type = 'comment' AND action = 'deleted' AND date(created_at) >= date('now', ?)", `-${days - 1} days`).count
      },
      series
    });
  });

  router.get('/api/admin/status', adminOnly, (_req, res) => {
    let database = 'online';
    let uploads = 'writable';
    try { one('SELECT 1 AS ok'); } catch { database = 'error'; }
    try { require('node:fs').accessSync(uploadRoot, require('node:fs').constants.W_OK); } catch { uploads = 'unavailable'; }
    res.json({ status: database === 'online' && uploads === 'writable' ? 'operational' : 'degraded', database, uploads, uptimeSeconds: Math.floor(process.uptime()), checkedAt: new Date().toISOString() });
  });

  router.get('/api/admin/users', adminOnly, (req, res) => {
    const search = String(req.query.search || '').trim().slice(0, 120);
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const clauses = [];
    const params = [];
    if (search) {
      clauses.push('(u.name LIKE ? OR u.email LIKE ? OR CAST(u.id AS TEXT) = ?)');
      params.push(`%${search}%`, `%${search}%`, search);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const users = all(`SELECT u.id, u.name, u.email, u.bio, u.profile_photo_path, u.last_active_at,
        u.created_at, u.is_admin, u.is_suspended, u.is_limited,
        u.uploads_blocked, u.comments_blocked,
        COUNT(v.id) AS video_count
      FROM users u LEFT JOIN videos v ON v.user_id = u.id
      ${where} GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
      .map(user => ({ ...user, profilePhotoUrl: user.profile_photo_path ? `/uploads/${user.profile_photo_path}` : null, isAdmin: Boolean(user.is_admin), isSuspended: Boolean(user.is_suspended), isLimited: Boolean(user.is_limited), uploadsBlocked: Boolean(user.uploads_blocked), commentsBlocked: Boolean(user.comments_blocked) }));
    const total = one(`SELECT COUNT(*) AS count FROM users u ${where}`, ...params).count;
    res.json({ users, total, limit, offset });
  });

  router.get('/api/admin/users/recent', adminOnly, (req, res) => {
    const limit = Math.max(1, Math.min(12, Number.parseInt(req.query.limit, 10) || 6));
    const users = all(`SELECT u.id, u.name, u.email, u.created_at, u.is_admin, u.is_suspended,
        u.profile_photo_path, COUNT(v.id) AS video_count
      FROM users u LEFT JOIN videos v ON v.user_id = u.id
      WHERE u.is_admin = 0
      GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC LIMIT ?`, limit)
      .map(user => ({ ...user, profilePhotoUrl: user.profile_photo_path ? `/uploads/${user.profile_photo_path}` : null,
        isAdmin: Boolean(user.is_admin), isSuspended: Boolean(user.is_suspended) }));
    res.json({ users });
  });

  router.get('/api/admin/creators', adminOnly, (_req, res) => {
    const creators = all(`SELECT u.id, u.name, u.email, u.is_admin, u.is_suspended, u.is_limited,
        COUNT(v.id) AS video_count
      FROM users u LEFT JOIN videos v ON v.user_id = u.id
      GROUP BY u.id ORDER BY lower(u.name), u.id`)
      .map(user => ({ id: user.id, name: user.name, email: user.email, isAdmin: Boolean(user.is_admin), isSuspended: Boolean(user.is_suspended), isLimited: Boolean(user.is_limited), videoCount: user.video_count }));
    res.json({ creators });
  });

  router.patch('/api/admin/users/:id/suspension', adminOnly, (req, res) => {
    const userId = Number(req.params.id);
    const suspended = req.body?.suspended;
    if (!Number.isSafeInteger(userId) || userId < 1 || typeof suspended !== 'boolean') {
      return res.status(400).json({ error: 'Choose a valid account and suspension status.' });
    }
    const target = one('SELECT id, email, is_admin FROM users WHERE id = ?', userId);
    if (!target) return res.status(404).json({ error: 'User account not found.' });
    if (target.is_admin || target.email.toLowerCase() === adminEmail.toLowerCase() || userId === req.session.userId) {
      return res.status(403).json({ error: 'The administrator account cannot be suspended.' });
    }
    run('UPDATE users SET is_suspended = ? WHERE id = ?', suspended ? 1 : 0, userId);
    logModeration(req.session.userId, 'user', userId, suspended ? 'suspended' : 'reactivated');
    res.json({ id: userId, isSuspended: suspended });
  });

  router.patch('/api/admin/users/:id/restrictions', adminOnly, (req, res) => {
    const userId = Number(req.params.id);
    const { limited, uploadsBlocked, commentsBlocked } = req.body || {};
    if (!Number.isSafeInteger(userId) || userId < 1 || [limited, uploadsBlocked, commentsBlocked].some(value => typeof value !== 'boolean')) {
      return res.status(400).json({ error: 'Choose valid account restriction settings.' });
    }
    const target = one('SELECT id, email, is_admin FROM users WHERE id = ?', userId);
    if (!target) return res.status(404).json({ error: 'User account not found.' });
    if (target.is_admin || target.email.toLowerCase() === adminEmail.toLowerCase() || userId === req.session.userId) {
      return res.status(403).json({ error: 'Administrator restrictions cannot be changed here.' });
    }
    run('UPDATE users SET is_limited = ?, uploads_blocked = ?, comments_blocked = ? WHERE id = ?',
      limited ? 1 : 0, uploadsBlocked ? 1 : 0, commentsBlocked ? 1 : 0, userId);
    logModeration(req.session.userId, 'user', userId, 'restrictions_changed', JSON.stringify({ limited, uploadsBlocked, commentsBlocked }));
    res.json({ id: userId, isLimited: limited, uploadsBlocked, commentsBlocked });
  });

  router.delete('/api/admin/users/:id', adminOnly, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isSafeInteger(userId) || userId < 1) return res.status(400).json({ error: 'Choose a valid user account.' });
    const target = one('SELECT id, email, is_admin, profile_photo_path FROM users WHERE id = ?', userId);
    if (!target) return res.status(404).json({ error: 'User account not found.' });
    if (target.is_admin || target.email.toLowerCase() === adminEmail.toLowerCase() || userId === req.session.userId) {
      return res.status(403).json({ error: 'The administrator account cannot be deleted.' });
    }
    const files = all('SELECT video_path, thumbnail_path FROM videos WHERE user_id = ?', userId);
    db.exec('BEGIN');
    try {
      run('DELETE FROM users WHERE id = ?', userId);
      logModeration(req.session.userId, 'user', userId, 'deleted');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      console.error('Admin account deletion error:', error);
      return res.status(500).json({ error: 'Could not delete that user account.' });
    }
    files.forEach(file => { removeUploadedFile(file.video_path); removeUploadedFile(file.thumbnail_path); });
    removeUploadedFile(target.profile_photo_path);
    res.json({ deleted: true, id: userId });
  });

  router.get('/api/admin/videos', adminOnly, (req, res) => {
    const search = String(req.query.search || '').trim().slice(0, 120);
    const creatorId = Number.parseInt(req.query.creatorId, 10) || 0;
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const clauses = [];
    const params = [];
    if (search) {
      clauses.push('(v.title LIKE ? OR v.description LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR CAST(v.id AS TEXT) = ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern, search);
    }
    if (creatorId > 0) { clauses.push('v.user_id = ?'); params.push(creatorId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const videos = all(`SELECT v.id, v.user_id AS userId, v.title, v.description, v.video_path,
        v.thumbnail_path, v.file_size AS fileSize, v.view_count AS viewCount, v.created_at AS createdAt,
        v.visibility, u.name AS creatorName, u.email AS creatorEmail
      FROM videos v JOIN users u ON u.id = v.user_id ${where}
      ORDER BY v.created_at DESC, v.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
      .map(video => ({ ...video, videoUrl: `/uploads/${video.video_path}`, thumbnailUrl: video.thumbnail_path ? `/uploads/${video.thumbnail_path}` : null }));
    const total = one(`SELECT COUNT(*) AS count FROM videos v JOIN users u ON u.id = v.user_id ${where}`, ...params).count;
    res.json({ videos, total, limit, offset });
  });

  router.patch('/api/admin/videos/:id/visibility', adminOnly, (req, res) => {
    const videoId = Number(req.params.id);
    const visibility = req.body?.visibility;
    if (!Number.isSafeInteger(videoId) || videoId < 1 || !['public', 'hidden', 'private'].includes(visibility)) {
      return res.status(400).json({ error: 'Choose public, hidden, or private visibility.' });
    }
    const result = run('UPDATE videos SET visibility = ? WHERE id = ?', visibility, videoId);
    if (!result.changes) return res.status(404).json({ error: 'Video not found.' });
    logModeration(req.session.userId, 'video', videoId, 'visibility_changed', visibility);
    res.json({ id: videoId, visibility });
  });

  router.get('/api/admin/comments', adminOnly, (req, res) => {
    const search = String(req.query.search || '').trim().slice(0, 120);
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const where = search ? 'WHERE c.content LIKE ? OR u.name LIKE ? OR v.title LIKE ? OR CAST(c.id AS TEXT) = ?' : '';
    const pattern = `%${search}%`;
    const params = search ? [pattern, pattern, pattern, search] : [];
    const comments = all(`SELECT c.id, c.content, c.created_at AS createdAt, c.video_id AS videoId,
        c.user_id AS userId, u.name AS authorName, u.email AS authorEmail,
        v.title AS videoTitle, v.user_id AS videoOwnerId,
        (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.status IN ('open', 'reviewing')) AS openReports
      FROM comments c JOIN users u ON u.id = c.user_id JOIN videos v ON v.id = c.video_id
      ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
    const total = one(`SELECT COUNT(*) AS count FROM comments c JOIN users u ON u.id = c.user_id JOIN videos v ON v.id = c.video_id ${where}`, ...params).count;
    res.json({ comments, total, limit, offset });
  });

  router.delete('/api/admin/comments/:id', adminOnly, (req, res) => {
    const commentId = Number(req.params.id);
    if (!Number.isSafeInteger(commentId) || commentId < 1) return res.status(400).json({ error: 'Choose a valid comment.' });
    const result = run('DELETE FROM comments WHERE id = ?', commentId);
    if (!result.changes) return res.status(404).json({ error: 'Comment not found.' });
    logModeration(req.session.userId, 'comment', commentId, 'deleted');
    res.json({ deleted: true, id: commentId });
  });

  router.get('/api/admin/reports', adminOnly, (req, res) => {
    const status = String(req.query.status || 'open');
    const allowedStatuses = ['open', 'reviewing', 'resolved', 'dismissed', 'all'];
    if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Choose a valid report status.' });
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const where = status === 'all' ? '' : 'WHERE r.status = ?';
    const params = status === 'all' ? [] : [status];
    const reports = all(`SELECT r.id, r.target_type AS targetType, r.target_id AS targetId,
        r.reason, r.details, r.status, r.admin_note AS adminNote, r.created_at AS createdAt,
        r.reviewed_at AS reviewedAt, reporter.name AS reporterName, reporter.email AS reporterEmail,
        COALESCE(v.title, target_user.name, 'Removed content') AS targetLabel,
        COALESCE(c.content, '') AS targetText,
        COALESCE(target_user.id, v.user_id) AS targetOwnerId,
        v.id AS relatedVideoId, target_user.is_suspended AS targetSuspended
      FROM reports r JOIN users reporter ON reporter.id = r.reporter_id
      LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
      LEFT JOIN videos v ON (r.target_type = 'video' AND v.id = r.target_id) OR (r.target_type = 'comment' AND v.id = c.video_id)
      LEFT JOIN users target_user ON (r.target_type = 'user' AND target_user.id = r.target_id)
        OR (r.target_type = 'comment' AND target_user.id = c.user_id)
        OR (r.target_type = 'video' AND target_user.id = v.user_id)
      ${where} ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END, r.created_at DESC
      LIMIT ? OFFSET ?`, ...params, limit, offset);
    const total = one(`SELECT COUNT(*) AS count FROM reports r ${where}`, ...params).count;
    res.json({ reports, total, limit, offset, status });
  });

  router.patch('/api/admin/reports/:id', adminOnly, (req, res) => {
    const reportId = Number(req.params.id);
    const status = String(req.body?.status || '');
    const adminNote = String(req.body?.adminNote || '').trim().slice(0, 1000);
    if (!Number.isSafeInteger(reportId) || reportId < 1 || !['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Choose a valid report status.' });
    }
    const result = run(`UPDATE reports SET status = ?, admin_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`,
      status, adminNote, status === 'open' ? null : new Date().toISOString(), req.session.userId, reportId);
    if (!result.changes) return res.status(404).json({ error: 'Report not found.' });
    logModeration(req.session.userId, 'report', reportId, 'status_changed', status);
    res.json({ id: reportId, status, adminNote });
  });

  router.delete('/api/admin/videos/:id', adminOnly, (req, res) => {
    const videoId = Number(req.params.id);
    if (!Number.isSafeInteger(videoId) || videoId < 1) return res.status(400).json({ error: 'Choose a valid video.' });
    const video = one('SELECT id, video_path, thumbnail_path FROM videos WHERE id = ?', videoId);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    try {
      run('DELETE FROM videos WHERE id = ?', videoId);
      logModeration(req.session.userId, 'video', videoId, 'deleted');
      removeUploadedFile(video.video_path);
      removeUploadedFile(video.thumbnail_path);
      res.json({ deleted: true, id: videoId });
    } catch (error) {
      console.error('Admin video deletion error:', error);
      res.status(500).json({ error: 'Could not delete that video.' });
    }
  });

  return router;
};
