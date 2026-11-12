const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const createAdminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const ADMIN_EMAIL = 'admin@frame.app';
const storageRoot = path.resolve(process.env.FRAME_STORAGE_DIR || ROOT);
const uploadRoot = path.join(storageRoot, 'uploads');
const videoDir = path.join(uploadRoot, 'videos');
const imageDir = path.join(uploadRoot, 'images');
const profilePhotoDir = path.join(uploadRoot, 'profile-photos');
const dataDir = path.join(storageRoot, 'data');
const databaseFile = path.join(dataDir, 'frame.sqlite');
const legacyJsonFile = path.join(dataDir, 'frame.json');
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || (production ? '' : 'change-this-secret-before-deploying');
if (production && sessionSecret.length < 32) {
  throw new Error('Set SESSION_SECRET to a private random value of at least 32 characters in production.');
}
for (const directory of [videoDir, imageDir, profilePhotoDir, dataDir]) fs.mkdirSync(directory, { recursive: true });

const db = new DatabaseSync(databaseFile, { enableForeignKeyConstraints: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    profile_photo_path TEXT,
    bio TEXT NOT NULL DEFAULT '',
    is_suspended INTEGER NOT NULL DEFAULT 0,
    is_limited INTEGER NOT NULL DEFAULT 0,
    uploads_blocked INTEGER NOT NULL DEFAULT 0,
    comments_blocked INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    video_path TEXT NOT NULL,
    thumbnail_path TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    comments_enabled INTEGER NOT NULL DEFAULT 1,
    visibility TEXT NOT NULL DEFAULT 'public',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS video_tags (
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (video_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS watch_history (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    last_watched_at TEXT NOT NULL,
    watch_seconds REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, video_id)
  );
  CREATE TABLE IF NOT EXISTS liked_videos (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, video_id)
  );
  CREATE TABLE IF NOT EXISTS video_dislikes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, video_id)
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    subscriber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (subscriber_id, creator_id),
    CHECK (subscriber_id <> creator_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    creator_heart INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('user', 'video', 'comment')),
    target_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS moderation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('user', 'video', 'comment', 'report')),
    target_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS comment_reactions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, comment_id)
  );
  CREATE TABLE IF NOT EXISTS watch_later (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, video_id)
  );
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, name)
  );
  CREATE TABLE IF NOT EXISTS playlist_videos (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, video_id)
  );
  CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_videos_user_created ON videos(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_history_user_recent ON watch_history(user_id, last_watched_at DESC);
  CREATE INDEX IF NOT EXISTS idx_likes_user_recent ON liked_videos(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_watch_later_user_recent ON watch_later(user_id, added_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_video_recent ON comments(video_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id, reaction);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_creator ON subscriptions(creator_id);
  CREATE INDEX IF NOT EXISTS idx_reports_status_recent ON reports(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_moderation_actions_recent ON moderation_actions(target_type, action, created_at DESC);
`);

if (!all('PRAGMA table_info(users)').some(column => column.name === 'profile_photo_path')) {
  db.exec('ALTER TABLE users ADD COLUMN profile_photo_path TEXT');
}
if (!all('PRAGMA table_info(users)').some(column => column.name === 'bio')) {
  db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
}
if (!all('PRAGMA table_info(users)').some(column => column.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}
if (!all('PRAGMA table_info(users)').some(column => column.name === 'is_suspended')) {
  db.exec('ALTER TABLE users ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0');
}
for (const column of ['is_limited', 'uploads_blocked', 'comments_blocked']) {
  if (!all('PRAGMA table_info(users)').some(row => row.name === column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
}
if (!all('PRAGMA table_info(users)').some(row => row.name === 'last_active_at')) {
  db.exec('ALTER TABLE users ADD COLUMN last_active_at TEXT');
}

if (!all('PRAGMA table_info(videos)').some(column => column.name === 'file_size')) {
  db.exec('ALTER TABLE videos ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0');
}
if (!all('PRAGMA table_info(videos)').some(column => column.name === 'view_count')) {
  db.exec('ALTER TABLE videos ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0');
}
if (!all('PRAGMA table_info(videos)').some(column => column.name === 'comments_enabled')) {
  db.exec('ALTER TABLE videos ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 1');
}
if (!all('PRAGMA table_info(videos)').some(column => column.name === 'visibility')) {
  db.exec("ALTER TABLE videos ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'");
}

function all(sql, ...params) { return db.prepare(sql).all(...params); }
function one(sql, ...params) { return db.prepare(sql).get(...params); }
function run(sql, ...params) { return db.prepare(sql).run(...params); }
function removeUploadedFile(relativePath) {
  if (!relativePath) return;
  const root = path.resolve(uploadRoot);
  const absolutePath = path.resolve(root, String(relativePath));
  if (absolutePath.startsWith(`${root}${path.sep}`)) {
    try { fs.rmSync(absolutePath, { force: true }); }
    catch (error) { console.warn('Could not remove uploaded file:', error.message); }
  }
}
function initializeAdminAccount() {
  const configuredPassword = process.env.ADMIN_PASSWORD || '';
  const admin = one('SELECT id FROM users WHERE email = ?', ADMIN_EMAIL);
  const passwordSeeded = one('SELECT value FROM app_settings WHERE key = ?', 'admin_password_seeded');
  run('UPDATE users SET is_admin = 0 WHERE email <> ?', ADMIN_EMAIL);

  if (!admin) {
    if (configuredPassword.length < 20) {
      console.warn('Admin account is not configured. Set ADMIN_PASSWORD to a strong secret of at least 20 characters.');
      return;
    }
    run('INSERT INTO users (name, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)',
      'Frame Administrator', ADMIN_EMAIL, bcrypt.hashSync(configuredPassword, 12), new Date().toISOString());
    run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'admin_password_seeded', '1');
    console.log(`Admin account configured for ${ADMIN_EMAIL}.`);
    return;
  }

  if (!passwordSeeded) {
    if (configuredPassword.length < 20) {
      run('UPDATE users SET is_admin = 0 WHERE id = ?', admin.id);
      console.warn('Admin account is disabled until ADMIN_PASSWORD is set to a strong secret of at least 20 characters.');
      return;
    }
    run('UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?', bcrypt.hashSync(configuredPassword, 12), admin.id);
    run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'admin_password_seeded', '1');
    console.log(`Admin account configured for ${ADMIN_EMAIL}.`);
    return;
  }

  run('UPDATE users SET is_admin = 1 WHERE id = ?', admin.id);
}
function tagsForVideo(videoId, csv = '') {
  const tags = [...new Set(String(csv).split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))];
  for (const tag of tags) {
    run('INSERT OR IGNORE INTO tags (name) VALUES (?)', tag);
    const row = one('SELECT id FROM tags WHERE name = ?', tag);
    run('INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)', videoId, row.id);
  }
}
function relocateLegacyFile(oldName, kind) {
  if (!oldName) return null;
  const folder = kind === 'video' ? 'videos' : 'images';
  const targetDir = kind === 'video' ? videoDir : imageDir;
  const normalized = String(oldName).replace(/\\/g, '/');
  let name = path.basename(normalized);
  const oldRelative = normalized.startsWith(`${folder}/`) ? normalized : name;
  let source = path.join(uploadRoot, ...oldRelative.split('/'));
  let target = path.join(targetDir, name);
  if (!fs.existsSync(source) && fs.existsSync(target)) return `${folder}/${name}`;
  if (!fs.existsSync(source)) {
    source = path.join(uploadRoot, name);
    if (!fs.existsSync(source)) return `${folder}/${name}`;
  }
  if (path.resolve(source) !== path.resolve(target)) {
    if (fs.existsSync(target)) {
      name = `${crypto.randomUUID()}${path.extname(name).toLowerCase()}`;
      target = path.join(targetDir, name);
    }
    fs.renameSync(source, target);
  }
  return `${folder}/${name}`;
}
function migrateLegacyJson() {
  if (one('SELECT value FROM app_settings WHERE key = ?', 'legacy_json_migrated')) return;
  if (!fs.existsSync(legacyJsonFile)) {
    run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'legacy_json_migrated', '1');
    return;
  }
  const legacy = JSON.parse(fs.readFileSync(legacyJsonFile, 'utf8'));
  db.exec('BEGIN');
  try {
    for (const user of legacy.users || []) {
      run('INSERT OR IGNORE INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
        user.id, user.name, user.email, user.password_hash, user.created_at || new Date().toISOString());
    }
    for (const video of legacy.videos || []) {
      const videoPath = relocateLegacyFile(video.video_file, 'video');
      const thumbnailPath = relocateLegacyFile(video.thumbnail_file, 'image');
      run(`INSERT OR IGNORE INTO videos (id, user_id, title, description, video_path, thumbnail_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, video.id, video.user_id, video.title, video.description || '', videoPath,
        thumbnailPath, video.created_at || new Date().toISOString());
      tagsForVideo(video.id, video.tags || '');
    }
    run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', 'legacy_json_migrated', '1');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
migrateLegacyJson();
initializeAdminAccount();

function videoSelect(where = '', order = 'v.created_at DESC') {
  return `SELECT v.id, v.user_id, v.title, v.description, v.video_path, v.thumbnail_path, v.file_size,
      v.view_count, v.comments_enabled, v.visibility, v.created_at,
      u.name AS creator, u.profile_photo_path AS creator_profile_photo_path,
      COALESCE(GROUP_CONCAT(DISTINCT t.name), '') AS tags
    FROM videos v
    JOIN users u ON u.id = v.user_id
    LEFT JOIN video_tags vt ON vt.video_id = v.id
    LEFT JOIN tags t ON t.id = vt.tag_id
    ${where}
    GROUP BY v.id
    ORDER BY ${order}`;
}
function publicVideo(row) {
  return {
    id: row.id, userId: row.user_id, title: row.title, description: row.description,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    videoUrl: `/uploads/${row.video_path}`,
    thumbnailUrl: row.thumbnail_path ? `/uploads/${row.thumbnail_path}` : null,
    fileSize: row.file_size || 0, viewCount: row.view_count || 0,
    commentsEnabled: row.comments_enabled !== 0, visibility: row.visibility || 'public', createdAt: row.created_at, creator: row.creator,
    creatorPhotoUrl: row.creator_profile_photo_path ? `/uploads/${row.creator_profile_photo_path}` : null
  };
}
function publicUser(row) {
  return row ? {
    id: row.id, name: row.name, email: row.email,
    profilePhotoUrl: row.profile_photo_path ? `/uploads/${row.profile_photo_path}` : null,
    bio: row.bio || '', createdAt: row.created_at
  } : null;
}
function publicCreator(row) {
  return row ? {
    id: row.id, name: row.name, bio: row.bio || '',
    profilePhotoUrl: row.profile_photo_path ? `/uploads/${row.profile_photo_path}` : null,
    createdAt: row.created_at
  } : null;
}
function videosForUser(userId) { return all(videoSelect('WHERE v.user_id = ?'), userId).map(publicVideo); }
function videoAccessible(videoId, viewerId) {
  const video = one('SELECT v.user_id, v.visibility, u.is_suspended FROM videos v JOIN users u ON u.id = v.user_id WHERE v.id = ?', videoId);
  if (!video) return false;
  const admin = viewerId ? one('SELECT id FROM users WHERE id = ? AND is_admin = 1 AND is_suspended = 0', viewerId) : null;
  if (video.is_suspended && !admin) return false;
  return video.visibility !== 'private' || video.user_id === viewerId || Boolean(admin);
}

app.use(express.json());
if (production) app.set('trust proxy', 1);
app.use(session({
  name: 'frame.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use((req, _res, next) => {
  const userId = req.session.userId;
  if (userId && req.path.startsWith('/api/')) {
    const user = one('SELECT last_active_at FROM users WHERE id = ?', userId);
    const now = new Date();
    if (user && (!user.last_active_at || now.getTime() - new Date(user.last_active_at).getTime() >= 60_000)) {
      run('UPDATE users SET last_active_at = ? WHERE id = ?', now.toISOString(), userId);
    }
  }
  next();
});
app.use(express.static(path.join(ROOT, 'public')));
app.get('/uploads/videos/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const video = one('SELECT v.user_id, v.visibility, u.is_suspended AS creator_suspended FROM videos v JOIN users u ON u.id = v.user_id WHERE v.video_path = ?', `videos/${file}`);
  if (!video) return res.sendStatus(404);
  const viewer = req.session.userId ? one('SELECT id, is_admin, is_suspended FROM users WHERE id = ?', req.session.userId) : null;
  const isAdmin = Boolean(viewer && viewer.is_admin && !viewer.is_suspended);
  if (video.creator_suspended && !isAdmin) return res.sendStatus(404);
  if (video.visibility === 'private' && (!viewer || viewer.is_suspended || (viewer.id !== video.user_id && !isAdmin))) return res.sendStatus(404);
  res.sendFile(path.join(videoDir, file));
});
app.get('/uploads/images/:file', (req, res, next) => {
  const file = path.basename(req.params.file);
  const video = one('SELECT user_id FROM videos WHERE thumbnail_path = ?', `images/${file}`);
  if (video) {
    const owner = one('SELECT is_suspended FROM users WHERE id = ?', video.user_id);
    const viewer = req.session.userId ? one('SELECT id, is_admin, is_suspended FROM users WHERE id = ?', req.session.userId) : null;
    const visibility = one('SELECT visibility FROM videos WHERE thumbnail_path = ?', `images/${file}`)?.visibility;
    const isAdmin = Boolean(viewer && viewer.is_admin && !viewer.is_suspended);
    if ((owner?.is_suspended && !isAdmin) || (visibility === 'private' && (!viewer || viewer.is_suspended || (viewer.id !== video.user_id && !isAdmin)))) return res.sendStatus(404);
  }
  next();
});
app.use('/uploads', express.static(uploadRoot));

const storage = multer.diskStorage({
  destination: (_req, file, done) => done(null, file.fieldname === 'video' ? videoDir : imageDir),
  filename: (_req, file, done) => done(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const videoExtensions = new Set(['.mp4', '.m4v', '.mov', '.webm', '.avi', '.mkv', '.mpg', '.mpeg', '.ogv', '.3gp', '.wmv']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    const mimeType = (file.mimetype || '').toLowerCase();
    const extension = path.extname(file.originalname).toLowerCase();
    const valid = file.fieldname === 'video'
      ? mimeType.startsWith('video/') || videoExtensions.has(extension)
      : file.fieldname === 'thumbnail' && (mimeType.startsWith('image/') || imageExtensions.has(extension));
    if (valid) return done(null, true);
    done(new Error(file.fieldname === 'video' ? 'Choose a video file such as MP4, MOV, WebM, AVI, or MKV.' : 'Choose an image file for the thumbnail.'));
  }
});
const profilePhotoStorage = multer.diskStorage({
  destination: (_req, _file, done) => done(null, profilePhotoDir),
  filename: (_req, file, done) => done(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
});
const profilePhotoUpload = multer({
  storage: profilePhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if ((file.mimetype || '').toLowerCase().startsWith('image/') && imageExtensions.has(extension)) return done(null, true);
    done(new Error('Choose a JPG, PNG, WebP, GIF, or AVIF image for your profile photo.'));
  }
}).single('photo');
function receiveProfilePhoto(req, res, next) {
  profilePhotoUpload(req, res, error => {
    if (error) return res.status(400).json({ error: error.message || 'Could not upload that profile photo.' });
    next();
  });
}

function signedIn(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please sign in first.' });
  const user = one('SELECT is_suspended FROM users WHERE id = ?', req.session.userId);
  if (!user) return req.session.destroy(() => res.status(401).json({ error: 'Please sign in again.' }));
  if (user.is_suspended) return req.session.destroy(() => res.status(403).json({ error: 'This account is suspended.' }));
  next();
}
function contentAllowed(req, res, next) {
  const user = one('SELECT is_limited FROM users WHERE id = ?', req.session.userId);
  if (user?.is_limited) return res.status(403).json({ error: 'This account is limited from posting and interacting with content.' });
  next();
}
function uploadAllowed(req, res, next) {
  const user = one('SELECT is_limited, uploads_blocked FROM users WHERE id = ?', req.session.userId);
  if (user?.is_limited || user?.uploads_blocked) return res.status(403).json({ error: 'This account is not allowed to upload videos.' });
  next();
}
function commentsAllowed(req, res, next) {
  const user = one('SELECT is_limited, comments_blocked FROM users WHERE id = ?', req.session.userId);
  if (user?.is_limited || user?.comments_blocked) return res.status(403).json({ error: 'This account is not allowed to post comments.' });
  next();
}
function adminOnly(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Admin sign-in required.' });
  const admin = one('SELECT id FROM users WHERE id = ? AND email = ? AND is_admin = 1 AND is_suspended = 0', req.session.userId, ADMIN_EMAIL);
  if (!admin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}
function recordWatch(userId, videoId, seconds = 0, completed = false) {
  run(`INSERT INTO watch_history (user_id, video_id, last_watched_at, watch_seconds, completed)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, video_id) DO UPDATE SET
      last_watched_at = excluded.last_watched_at,
      watch_seconds = MAX(watch_history.watch_seconds, excluded.watch_seconds),
      completed = MAX(watch_history.completed, excluded.completed)`,
  userId, videoId, new Date().toISOString(), Math.max(0, Number(seconds) || 0), completed ? 1 : 0);
}

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = one('SELECT id, name, email, profile_photo_path, bio, created_at, is_suspended FROM users WHERE id = ?', req.session.userId);
  if (!user || user.is_suspended) return req.session.destroy(() => res.json({ user: null }));
  res.json({ user: publicUser(user) });
});
app.put('/api/me', signedIn, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const bio = String(req.body?.bio || '').trim();
  if (!name || name.length > 80 || bio.length > 1000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a name and valid email. Your name can be 80 characters and bio 1,000 characters.' });
  }
  const user = one('SELECT id FROM users WHERE id = ?', req.session.userId);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  try {
    run('UPDATE users SET name = ?, email = ?, bio = ? WHERE id = ?', name, email, bio, user.id);
    res.json({ user: publicUser(one('SELECT id, name, email, profile_photo_path, bio, created_at FROM users WHERE id = ?', user.id)) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'That email address is already used by another account.' });
    console.error('Account settings error:', error);
    res.status(500).json({ error: 'Could not save account settings.' });
  }
});
app.post('/api/me/profile-photo', signedIn, receiveProfilePhoto, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a profile photo first.' });
  const relativePath = `profile-photos/${req.file.filename}`;
  const user = one('SELECT profile_photo_path FROM users WHERE id = ?', req.session.userId);
  run('UPDATE users SET profile_photo_path = ? WHERE id = ?', relativePath, req.session.userId);
  if (user?.profile_photo_path) {
    const oldPath = path.join(profilePhotoDir, path.basename(user.profile_photo_path));
    if (path.dirname(oldPath) === path.resolve(profilePhotoDir)) { try { fs.rmSync(oldPath, { force: true }); } catch (error) { console.warn('Could not clean up old profile photo:', error.message); } }
  }
  res.json({ user: publicUser(one('SELECT id, name, email, profile_photo_path, bio, created_at FROM users WHERE id = ?', req.session.userId)) });
});
app.delete('/api/me/profile-photo', signedIn, (req, res) => {
  const user = one('SELECT profile_photo_path FROM users WHERE id = ?', req.session.userId);
  run('UPDATE users SET profile_photo_path = NULL WHERE id = ?', req.session.userId);
  if (user?.profile_photo_path) {
    const oldPath = path.join(profilePhotoDir, path.basename(user.profile_photo_path));
    if (path.dirname(oldPath) === path.resolve(profilePhotoDir)) { try { fs.rmSync(oldPath, { force: true }); } catch (error) { console.warn('Could not remove profile photo:', error.message); } }
  }
  res.json({ user: publicUser(one('SELECT id, name, email, profile_photo_path, bio, created_at FROM users WHERE id = ?', req.session.userId)) });
});
app.put('/api/me/profile', signedIn, receiveProfilePhoto, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const bio = String(req.body?.bio || '').trim();
  if (!name || name.length > 80 || bio.length > 1000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: 'Enter a name and valid email. Your name can be 80 characters and bio 1,000 characters.' });
  }
  const user = one('SELECT id, profile_photo_path FROM users WHERE id = ?', req.session.userId);
  if (!user) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  try {
    const photoPath = req.file ? `profile-photos/${req.file.filename}` : user.profile_photo_path;
    run('UPDATE users SET name = ?, email = ?, bio = ?, profile_photo_path = ? WHERE id = ?',
      name, email, bio, photoPath, user.id);
    if (req.file && user.profile_photo_path) {
      const oldPath = path.join(profilePhotoDir, path.basename(user.profile_photo_path));
      if (path.dirname(oldPath) === path.resolve(profilePhotoDir)) { try { fs.rmSync(oldPath, { force: true }); } catch (error) { console.warn('Could not clean up old profile photo:', error.message); } }
    }
    res.json({ user: publicUser(one('SELECT id, name, email, profile_photo_path, bio, created_at FROM users WHERE id = ?', user.id)) });
  } catch (error) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'That email address is already used by another account.' });
    console.error('Profile settings error:', error);
    res.status(500).json({ error: 'Could not save profile settings.' });
  }
});
app.put('/api/me/password', signedIn, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Enter your current password and a new password of at least 8 characters.' });
  }
  const user = one('SELECT password_hash FROM users WHERE id = ?', req.session.userId);
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  try {
    run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(newPassword, 12), req.session.userId);
    res.json({ ok: true });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Could not change your password.' });
  }
});
app.get('/api/creators/:id', (req, res) => {
  const creatorId = Number(req.params.id);
  const viewerId = req.session.userId || null;
  const isAdmin = Boolean(viewerId && one('SELECT id FROM users WHERE id = ? AND email = ? AND is_admin = 1 AND is_suspended = 0', viewerId, ADMIN_EMAIL));
  const row = one('SELECT id, name, bio, profile_photo_path, created_at, is_suspended FROM users WHERE id = ?', creatorId);
  if (!row || (row.is_suspended && !isAdmin)) return res.status(404).json({ error: 'Creator not found.' });
  const videos = isAdmin
    ? all(videoSelect('WHERE v.user_id = ?'), creatorId)
    : all(videoSelect('WHERE v.user_id = ? AND (v.visibility = \'public\' OR v.user_id = ?)'), creatorId, viewerId || 0);
  res.json({
    creator: publicCreator(row),
    videos: videos.map(publicVideo),
    stats: {
      videos: one('SELECT COUNT(*) AS count FROM videos WHERE user_id = ?', creatorId).count,
      subscribers: one('SELECT COUNT(*) AS count FROM subscriptions WHERE creator_id = ?', creatorId).count
    },
    viewer: { subscribed: Boolean(viewerId && one('SELECT 1 FROM subscriptions WHERE subscriber_id = ? AND creator_id = ?', viewerId, creatorId)) },
    isSelf: viewerId === creatorId
  });
});
app.post('/api/creators/:id/subscribe', signedIn, contentAllowed, (req, res) => {
  const creatorId = Number(req.params.id);
  if (!one('SELECT id FROM users WHERE id = ?', creatorId)) return res.status(404).json({ error: 'Creator not found.' });
  if (creatorId === req.session.userId) return res.status(400).json({ error: 'You cannot subscribe to your own account.' });
  run('INSERT OR IGNORE INTO subscriptions (subscriber_id, creator_id) VALUES (?, ?)', req.session.userId, creatorId);
  res.json({ subscribed: true, subscribers: one('SELECT COUNT(*) AS count FROM subscriptions WHERE creator_id = ?', creatorId).count });
});
app.delete('/api/creators/:id/subscribe', signedIn, contentAllowed, (req, res) => {
  const creatorId = Number(req.params.id);
  if (!one('SELECT id FROM users WHERE id = ?', creatorId)) return res.status(404).json({ error: 'Creator not found.' });
  run('DELETE FROM subscriptions WHERE subscriber_id = ? AND creator_id = ?', req.session.userId, creatorId);
  res.json({ subscribed: false, subscribers: one('SELECT COUNT(*) AS count FROM subscriptions WHERE creator_id = ?', creatorId).count });
});
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) return res.status(400).json({ error: 'Add your name, email, and a password of at least 8 characters.' });
  try {
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail === ADMIN_EMAIL) return res.status(409).json({ error: 'That email is reserved for the administrator account.' });
    if (one('SELECT id FROM users WHERE email = ?', normalizedEmail)) return res.status(409).json({ error: 'An account with that email already exists.' });
    const result = run('INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      name.trim(), normalizedEmail, await bcrypt.hash(password, 12), new Date().toISOString());
    req.session.userId = Number(result.lastInsertRowid);
    run('UPDATE users SET last_active_at = ? WHERE id = ?', new Date().toISOString(), req.session.userId);
    res.status(201).json({ user: publicUser(one('SELECT id, name, email, profile_photo_path, bio, created_at FROM users WHERE id = ?', Number(result.lastInsertRowid))) });
  } catch (error) { console.error('Registration error:', error); res.status(500).json({ error: 'Could not create your account.' }); }
});
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = one('SELECT * FROM users WHERE email = ?', (email || '').trim().toLowerCase());
  if (!user || user.is_admin || !(await bcrypt.compare(password || '', user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (user.is_suspended) return res.status(403).json({ error: 'This account is suspended. Contact the platform administrator.' });
  req.session.userId = user.id;
  run('UPDATE users SET last_active_at = ? WHERE id = ?', new Date().toISOString(), user.id);
  res.json({ user: publicUser(user) });
});
app.post('/api/reports', signedIn, (req, res) => {
  const targetType = String(req.body?.targetType || '');
  const targetId = Number(req.body?.targetId);
  const reason = String(req.body?.reason || '').trim();
  const details = String(req.body?.details || '').trim();
  const reasons = ['spam', 'harassment', 'inappropriate', 'violence', 'copyright', 'other'];
  if (!['user', 'video', 'comment'].includes(targetType) || !Number.isSafeInteger(targetId) || targetId < 1 || !reasons.includes(reason) || details.length > 1000) {
    return res.status(400).json({ error: 'Choose a report reason and provide valid details.' });
  }
  let targetOwnerId;
  if (targetType === 'user') targetOwnerId = one('SELECT id FROM users WHERE id = ? AND is_admin = 0', targetId)?.id;
  if (targetType === 'video') targetOwnerId = one('SELECT user_id FROM videos WHERE id = ?', targetId)?.user_id;
  if (targetType === 'comment') targetOwnerId = one('SELECT user_id FROM comments WHERE id = ?', targetId)?.user_id;
  if (!targetOwnerId) return res.status(404).json({ error: 'That account or content could not be found.' });
  if (targetOwnerId === req.session.userId) return res.status(400).json({ error: 'You cannot report your own account or content.' });
  if (one("SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status IN ('open', 'reviewing')", req.session.userId, targetType, targetId)) {
    return res.status(409).json({ error: 'You already have an open report for this item.' });
  }
  const result = run(`INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`, req.session.userId, targetType, targetId, reason, details, new Date().toISOString());
  res.status(201).json({ id: Number(result.lastInsertRowid), status: 'open' });
});
app.use(createAdminRouter({ one, all, run, db, bcrypt, adminOnly, adminEmail: ADMIN_EMAIL, root: ROOT, uploadRoot, removeUploadedFile }));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/my/videos', signedIn, (req, res) => res.json({ videos: videosForUser(req.session.userId) }));
app.put('/api/my/videos/:id', signedIn, (req, res) => {
  const videoId = Number(req.params.id);
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const tags = String(req.body?.tags || '');
  const ownedVideo = one('SELECT id FROM videos WHERE id = ? AND user_id = ?', videoId, req.session.userId);
  if (!ownedVideo) return res.status(404).json({ error: 'That video is not in your uploads.' });
  if (!title || title.length > 120 || description.length > 5000 || tags.length > 500) {
    return res.status(400).json({ error: 'Add a title up to 120 characters. Description and tags must be under their limits.' });
  }
  db.exec('BEGIN');
  try {
    run('UPDATE videos SET title = ?, description = ? WHERE id = ? AND user_id = ?', title, description, videoId, req.session.userId);
    run('DELETE FROM video_tags WHERE video_id = ?', videoId);
    tagsForVideo(videoId, tags);
    db.exec('COMMIT');
    res.json({ video: publicVideo(one(videoSelect('WHERE v.id = ? AND v.user_id = ?'), videoId, req.session.userId)) });
  } catch (error) {
    db.exec('ROLLBACK');
    console.error('Video update error:', error);
    res.status(500).json({ error: 'Could not update this video.' });
  }
});
app.delete('/api/my/videos/:id', signedIn, (req, res) => {
  const videoId = Number(req.params.id);
  const video = one('SELECT video_path, thumbnail_path FROM videos WHERE id = ? AND user_id = ?', videoId, req.session.userId);
  if (!video) return res.status(404).json({ error: 'That video is not in your uploads.' });
  run('DELETE FROM videos WHERE id = ? AND user_id = ?', videoId, req.session.userId);
  for (const relativePath of [video.video_path, video.thumbnail_path]) {
    if (!relativePath) continue;
    const absolutePath = path.resolve(uploadRoot, relativePath);
    if (absolutePath.startsWith(`${path.resolve(uploadRoot)}${path.sep}`)) fs.rmSync(absolutePath, { force: true });
  }
  res.json({ deleted: true, id: videoId });
});
app.get('/api/videos', (req, res) => {
  const search = (req.query.q || '').trim();
  const tag = (req.query.tag || '').trim();
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push(`(v.title LIKE ? OR v.description LIKE ? OR u.name LIKE ? OR EXISTS (
      SELECT 1 FROM video_tags qvt JOIN tags qt ON qt.id = qvt.tag_id WHERE qvt.video_id = v.id AND qt.name LIKE ?))`);
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  if (tag) {
    clauses.push('EXISTS (SELECT 1 FROM video_tags tvt JOIN tags tt ON tt.id = tvt.tag_id WHERE tvt.video_id = v.id AND lower(tt.name) = lower(?))');
    params.push(tag);
  }
  clauses.push("u.is_suspended = 0 AND v.visibility = 'public'");
  const where = `WHERE ${clauses.join(' AND ')}`;
  const limit = Math.max(1, Math.min(60, Number.parseInt(req.query.limit, 10) || 24));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  res.json({ videos: all(`${videoSelect(where)} LIMIT ? OFFSET ?`, ...params, limit, offset).map(publicVideo) });
});
app.get('/api/videos/:id', (req, res) => {
  const videoId = Number(req.params.id);
  const row = one(videoSelect('WHERE v.id = ?'), videoId);
  if (!row) return res.status(404).json({ error: 'Video not found.' });
  const video = publicVideo(row);
  const viewerId = req.session.userId || null;
  const isAdmin = Boolean(viewerId && one('SELECT id FROM users WHERE id = ? AND is_admin = 1 AND is_suspended = 0', viewerId));
  if (one('SELECT is_suspended FROM users WHERE id = ?', row.user_id)?.is_suspended && !isAdmin) return res.status(404).json({ error: 'Video not found.' });
  if (row.visibility === 'private' && viewerId !== row.user_id && !isAdmin) return res.status(404).json({ error: 'Video not found.' });
  const stats = {
    views: Number(row.view_count || 0),
    likes: one('SELECT COUNT(*) AS count FROM liked_videos WHERE video_id = ?', videoId).count,
    dislikes: one('SELECT COUNT(*) AS count FROM video_dislikes WHERE video_id = ?', videoId).count,
    subscribers: one('SELECT COUNT(*) AS count FROM subscriptions WHERE creator_id = ?', row.user_id).count
  };
  const viewer = viewerId ? {
    reaction: one('SELECT 1 AS value FROM liked_videos WHERE user_id = ? AND video_id = ?', viewerId, videoId) ? 'like'
      : one('SELECT 1 AS value FROM video_dislikes WHERE user_id = ? AND video_id = ?', viewerId, videoId) ? 'dislike' : null,
    saved: Boolean(one('SELECT 1 AS value FROM watch_later WHERE user_id = ? AND video_id = ?', viewerId, videoId)),
    subscribed: Boolean(one('SELECT 1 AS value FROM subscriptions WHERE subscriber_id = ? AND creator_id = ?', viewerId, row.user_id))
  } : { reaction: null, saved: false, subscribed: false };
  res.json({ video, stats, viewer, isOwner: viewerId === row.user_id });
});
app.post('/api/videos/:id/view', (req, res) => {
  const videoId = Number(req.params.id);
  const row = one('SELECT id, user_id, visibility FROM videos WHERE id = ?', videoId);
  if (!row) return res.status(404).json({ error: 'Video not found.' });
  const viewerId = req.session.userId || null;
  const isAdmin = Boolean(viewerId && one('SELECT id FROM users WHERE id = ? AND is_admin = 1 AND is_suspended = 0', viewerId));
  if (one('SELECT is_suspended FROM users WHERE id = ?', row.user_id)?.is_suspended && !isAdmin) return res.status(404).json({ error: 'Video not found.' });
  if (row.visibility === 'private' && viewerId !== row.user_id && !isAdmin) return res.status(404).json({ error: 'Video not found.' });
  run('UPDATE videos SET view_count = view_count + 1 WHERE id = ?', videoId);
  if (req.session.userId) recordWatch(req.session.userId, videoId, 0, false);
  res.json({ views: one('SELECT view_count FROM videos WHERE id = ?', videoId).view_count });
});
app.put('/api/videos/:id/reaction', signedIn, contentAllowed, (req, res) => {
  const videoId = Number(req.params.id);
  if (!videoAccessible(videoId, req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  const reaction = req.body?.reaction;
  if (!['like', 'dislike', 'none'].includes(reaction)) return res.status(400).json({ error: 'Choose like, dislike, or none.' });
  db.exec('BEGIN');
  try {
    run('DELETE FROM liked_videos WHERE user_id = ? AND video_id = ?', req.session.userId, videoId);
    run('DELETE FROM video_dislikes WHERE user_id = ? AND video_id = ?', req.session.userId, videoId);
    if (reaction === 'like') run('INSERT INTO liked_videos (user_id, video_id) VALUES (?, ?)', req.session.userId, videoId);
    if (reaction === 'dislike') run('INSERT INTO video_dislikes (user_id, video_id) VALUES (?, ?)', req.session.userId, videoId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ reaction });
});
app.post('/api/videos/:id/subscribe', signedIn, contentAllowed, (req, res) => {
  const video = one('SELECT user_id FROM videos WHERE id = ?', Number(req.params.id));
  if (!video) return res.status(404).json({ error: 'Video not found.' });
  if (!videoAccessible(Number(req.params.id), req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  if (video.user_id === req.session.userId) return res.status(400).json({ error: 'You cannot subscribe to your own channel.' });
  run('INSERT OR IGNORE INTO subscriptions (subscriber_id, creator_id) VALUES (?, ?)', req.session.userId, video.user_id);
  res.json({ subscribed: true, subscribers: one('SELECT COUNT(*) AS count FROM subscriptions WHERE creator_id = ?', video.user_id).count });
});
app.delete('/api/videos/:id/subscribe', signedIn, contentAllowed, (req, res) => {
  const video = one('SELECT user_id FROM videos WHERE id = ?', Number(req.params.id));
  if (!video) return res.status(404).json({ error: 'Video not found.' });
  if (!videoAccessible(Number(req.params.id), req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  run('DELETE FROM subscriptions WHERE subscriber_id = ? AND creator_id = ?', req.session.userId, video.user_id);
  res.json({ subscribed: false, subscribers: one('SELECT COUNT(*) AS count FROM subscriptions WHERE creator_id = ?', video.user_id).count });
});
app.get('/api/videos/:id/comments', (req, res) => {
  const videoId = Number(req.params.id);
  const video = one('SELECT user_id, comments_enabled FROM videos WHERE id = ?', videoId);
  if (!video) return res.status(404).json({ error: 'Video not found.' });
  if (!videoAccessible(videoId, req.session.userId || null)) return res.status(404).json({ error: 'Video not found.' });
  const isOwner = req.session.userId === video.user_id;
  const isAdmin = Boolean(req.session.userId && one('SELECT id FROM users WHERE id = ? AND is_admin = 1', req.session.userId));
  const visibility = one('SELECT visibility FROM videos WHERE id = ?', videoId)?.visibility;
  if (visibility === 'private' && !isOwner && !isAdmin) return res.status(404).json({ error: 'Video not found.' });
  const commentsEnabled = Boolean(video.comments_enabled);
  if (!commentsEnabled && !isOwner) return res.json({ comments: [], commentsEnabled, isOwner });
  const sort = req.query.sort === 'oldest' ? 'c.created_at ASC' : 'c.created_at DESC';
  const comments = all(`SELECT c.id, c.video_id, c.user_id, c.parent_id, c.content, c.created_at,
      c.updated_at, c.creator_heart, c.is_pinned, u.name AS author, u.profile_photo_path AS author_photo_path,
      COALESCE(reaction_counts.likes, 0) AS likes, COALESCE(reaction_counts.dislikes, 0) AS dislikes,
      viewer_reaction.reaction AS viewer_reaction
    FROM comments c JOIN users u ON u.id = c.user_id
    LEFT JOIN comment_reactions viewer_reaction ON viewer_reaction.comment_id = c.id AND viewer_reaction.user_id = ?
    LEFT JOIN (SELECT comment_id, SUM(reaction = 'like') AS likes, SUM(reaction = 'dislike') AS dislikes
      FROM comment_reactions GROUP BY comment_id) reaction_counts ON reaction_counts.comment_id = c.id
    WHERE c.video_id = ?
    ORDER BY c.is_pinned DESC, ${sort}, c.id ASC LIMIT 500`, req.session.userId || 0, videoId).map(comment => ({
      id: comment.id, videoId: comment.video_id, userId: comment.user_id, parentId: comment.parent_id,
      content: comment.content, createdAt: comment.created_at, updatedAt: comment.updated_at,
      creatorHeart: Boolean(comment.creator_heart), pinned: Boolean(comment.is_pinned),
      author: comment.author, authorPhotoUrl: comment.author_photo_path ? `/uploads/${comment.author_photo_path}` : null,
      likes: Number(comment.likes), dislikes: Number(comment.dislikes),
      viewerReaction: comment.viewer_reaction || null, isAuthor: req.session.userId === comment.user_id,
      canManage: isOwner || req.session.userId === comment.user_id
    }));
  res.json({ comments, commentsEnabled, isOwner });
});
app.put('/api/comments/:id/reaction', signedIn, contentAllowed, (req, res) => {
  const commentId = Number(req.params.id);
  const reaction = req.body?.reaction;
  if (!['like', 'dislike', 'none'].includes(reaction)) return res.status(400).json({ error: 'Choose like, dislike, or none.' });
  if (!one('SELECT id FROM comments WHERE id = ?', commentId)) return res.status(404).json({ error: 'Comment not found.' });
  if (reaction === 'none') {
    run('DELETE FROM comment_reactions WHERE user_id = ? AND comment_id = ?', req.session.userId, commentId);
  } else {
    run(`INSERT INTO comment_reactions (user_id, comment_id, reaction, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, comment_id) DO UPDATE SET reaction = excluded.reaction, created_at = excluded.created_at`,
    req.session.userId, commentId, reaction, new Date().toISOString());
  }
  res.json({ reaction });
});
app.post('/api/videos/:id/comments', signedIn, commentsAllowed, (req, res) => {
  const videoId = Number(req.params.id);
  const video = one('SELECT user_id, comments_enabled FROM videos WHERE id = ?', videoId);
  if (!video) return res.status(404).json({ error: 'Video not found.' });
  if (!videoAccessible(videoId, req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  if (!video.comments_enabled && video.user_id !== req.session.userId) return res.status(403).json({ error: 'Comments are turned off for this video.' });
  const content = String(req.body?.content || '').trim();
  if (!content || content.length > 1500) return res.status(400).json({ error: 'Write a comment up to 1,500 characters.' });
  let parentId = req.body?.parentId ? Number(req.body.parentId) : null;
  if (parentId) {
    const parent = one('SELECT id, parent_id FROM comments WHERE id = ? AND video_id = ?', parentId, videoId);
    if (!parent) return res.status(404).json({ error: 'Comment not found.' });
    if (parent.parent_id) parentId = parent.parent_id;
  }
  const createdAt = new Date().toISOString();
  const result = run('INSERT INTO comments (video_id, user_id, parent_id, content, created_at) VALUES (?, ?, ?, ?, ?)', videoId, req.session.userId, parentId, content, createdAt);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});
app.put('/api/videos/:id/comments-settings', signedIn, (req, res) => {
  const videoId = Number(req.params.id);
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Choose whether comments are on or off.' });
  const result = run('UPDATE videos SET comments_enabled = ? WHERE id = ? AND user_id = ?', enabled ? 1 : 0, videoId, req.session.userId);
  if (!result.changes) return res.status(404).json({ error: 'That video is not yours.' });
  res.json({ commentsEnabled: enabled });
});
app.post('/api/comments/:id/heart', signedIn, (req, res) => {
  const comment = one('SELECT c.id, c.creator_heart, v.user_id AS owner_id FROM comments c JOIN videos v ON v.id = c.video_id WHERE c.id = ?', Number(req.params.id));
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (comment.owner_id !== req.session.userId) return res.status(403).json({ error: 'Only the video owner can heart comments.' });
  const hearted = !comment.creator_heart;
  run('UPDATE comments SET creator_heart = ? WHERE id = ?', hearted ? 1 : 0, comment.id);
  res.json({ hearted });
});
app.post('/api/comments/:id/pin', signedIn, (req, res) => {
  const comment = one('SELECT c.id, c.video_id, c.is_pinned, v.user_id AS owner_id FROM comments c JOIN videos v ON v.id = c.video_id WHERE c.id = ?', Number(req.params.id));
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (comment.owner_id !== req.session.userId) return res.status(403).json({ error: 'Only the video owner can pin comments.' });
  const pinned = !comment.is_pinned;
  db.exec('BEGIN');
  try {
    run('UPDATE comments SET is_pinned = 0 WHERE video_id = ?', comment.video_id);
    if (pinned) run('UPDATE comments SET is_pinned = 1 WHERE id = ?', comment.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json({ pinned });
});
app.delete('/api/comments/:id', signedIn, (req, res) => {
  const comment = one('SELECT c.id, c.user_id, v.user_id AS owner_id FROM comments c JOIN videos v ON v.id = c.video_id WHERE c.id = ?', Number(req.params.id));
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (comment.user_id !== req.session.userId && comment.owner_id !== req.session.userId) return res.status(403).json({ error: 'You cannot delete this comment.' });
  run('DELETE FROM comments WHERE id = ?', comment.id);
  res.json({ deleted: true });
});
app.post('/api/videos', signedIn, uploadAllowed, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), (req, res) => {
  const { title, description = '', tags = '' } = req.body;
  const video = req.files?.video?.[0];
  const thumbnail = req.files?.thumbnail?.[0];
  if (!title?.trim() || !video) {
    if (video) fs.rmSync(video.path, { force: true });
    if (thumbnail) fs.rmSync(thumbnail.path, { force: true });
    return res.status(400).json({ error: 'A title and video file are required.' });
  }
  const result = run(`INSERT INTO videos (user_id, title, description, video_path, thumbnail_path, file_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, req.session.userId, title.trim(), description.trim(), `videos/${video.filename}`,
  thumbnail ? `images/${thumbnail.filename}` : null, video.size, new Date().toISOString());
  tagsForVideo(Number(result.lastInsertRowid), tags);
  res.status(201).json({ video: publicVideo(one(videoSelect('WHERE v.id = ?'), Number(result.lastInsertRowid))) });
});

app.get('/api/me/library', signedIn, (req, res) => {
  const userId = req.session.userId;
  const byId = id => one(videoSelect('WHERE v.id = ?'), id);
  const history = all('SELECT video_id, last_watched_at, watch_seconds, completed FROM watch_history WHERE user_id = ? ORDER BY last_watched_at DESC LIMIT 100', userId)
    .filter(row => videoAccessible(row.video_id, userId))
    .map(row => ({ ...publicVideo(byId(row.video_id)), lastWatchedAt: row.last_watched_at, watchSeconds: row.watch_seconds, completed: Boolean(row.completed) }));
  const liked = all('SELECT video_id FROM liked_videos WHERE user_id = ? ORDER BY created_at DESC', userId).filter(row => videoAccessible(row.video_id, userId)).map(row => publicVideo(byId(row.video_id)));
  const watchLater = all('SELECT video_id FROM watch_later WHERE user_id = ? ORDER BY added_at DESC', userId).filter(row => videoAccessible(row.video_id, userId)).map(row => publicVideo(byId(row.video_id)));
  const playlists = all('SELECT id, name, description, created_at FROM playlists WHERE user_id = ? ORDER BY created_at DESC', userId)
    .map(list => ({ ...list, videos: all('SELECT video_id FROM playlist_videos WHERE playlist_id = ? ORDER BY position, added_at', list.id).map(row => publicVideo(byId(row.video_id))) }));
  for (const playlist of playlists) playlist.videos = playlist.videos.filter(video => videoAccessible(video.id, userId));
  res.json({ history, liked, watchLater, playlists });
});
app.post('/api/videos/:id/like', signedIn, contentAllowed, (req, res) => {
  const videoId = Number(req.params.id);
  if (!videoAccessible(videoId, req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  run('DELETE FROM video_dislikes WHERE user_id = ? AND video_id = ?', req.session.userId, videoId);
  run('INSERT OR IGNORE INTO liked_videos (user_id, video_id) VALUES (?, ?)', req.session.userId, videoId);
  res.json({ liked: true });
});
app.delete('/api/videos/:id/like', signedIn, contentAllowed, (req, res) => {
  run('DELETE FROM liked_videos WHERE user_id = ? AND video_id = ?', req.session.userId, Number(req.params.id));
  res.json({ liked: false });
});
app.post('/api/videos/:id/watch-later', signedIn, contentAllowed, (req, res) => {
  const videoId = Number(req.params.id);
  if (!videoAccessible(videoId, req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  run('INSERT OR IGNORE INTO watch_later (user_id, video_id) VALUES (?, ?)', req.session.userId, videoId);
  res.json({ saved: true });
});
app.delete('/api/videos/:id/watch-later', signedIn, contentAllowed, (req, res) => {
  run('DELETE FROM watch_later WHERE user_id = ? AND video_id = ?', req.session.userId, Number(req.params.id));
  res.json({ saved: false });
});
app.post('/api/videos/:id/history', signedIn, (req, res) => {
  const videoId = Number(req.params.id);
  if (!videoAccessible(videoId, req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  recordWatch(req.session.userId, videoId, req.body?.watchSeconds, req.body?.completed);
  res.json({ ok: true });
});
app.post('/api/playlists', signedIn, contentAllowed, (req, res) => {
  const name = (req.body?.name || '').trim();
  const description = (req.body?.description || '').trim();
  if (!name) return res.status(400).json({ error: 'Enter a playlist name.' });
  try {
    const result = run('INSERT INTO playlists (user_id, name, description, created_at) VALUES (?, ?, ?, ?)', req.session.userId, name, description, new Date().toISOString());
    res.status(201).json({ playlist: { id: Number(result.lastInsertRowid), name, description, videos: [] } });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'You already have a playlist with that name.' });
    res.status(500).json({ error: 'Could not create playlist.' });
  }
});
app.put('/api/playlists/:id', signedIn, contentAllowed, (req, res) => {
  const playlistId = Number(req.params.id);
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  if (!name || name.length > 80 || description.length > 1000) return res.status(400).json({ error: 'Add a playlist name up to 80 characters.' });
  try {
    const result = run('UPDATE playlists SET name = ?, description = ? WHERE id = ? AND user_id = ?', name, description, playlistId, req.session.userId);
    if (!result.changes) return res.status(404).json({ error: 'Playlist not found.' });
    res.json({ playlist: one('SELECT id, name, description, created_at FROM playlists WHERE id = ?', playlistId) });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(409).json({ error: 'You already have a playlist with that name.' });
    res.status(500).json({ error: 'Could not update playlist.' });
  }
});
app.delete('/api/playlists/:id', signedIn, contentAllowed, (req, res) => {
  const result = run('DELETE FROM playlists WHERE id = ? AND user_id = ?', Number(req.params.id), req.session.userId);
  if (!result.changes) return res.status(404).json({ error: 'Playlist not found.' });
  res.json({ deleted: true });
});
app.post('/api/playlists/:id/videos', signedIn, contentAllowed, (req, res) => {
  const playlistId = Number(req.params.id);
  const videoId = Number(req.body?.videoId);
  const playlist = one('SELECT id FROM playlists WHERE id = ? AND user_id = ?', playlistId, req.session.userId);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found.' });
  if (!videoAccessible(videoId, req.session.userId)) return res.status(404).json({ error: 'Video not found.' });
  const position = one('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM playlist_videos WHERE playlist_id = ?', playlistId).value;
  run('INSERT OR IGNORE INTO playlist_videos (playlist_id, video_id, position) VALUES (?, ?, ?)', playlistId, videoId, position);
  res.json({ ok: true });
});
app.delete('/api/playlists/:id/videos/:videoId', signedIn, contentAllowed, (req, res) => {
  const playlistId = Number(req.params.id);
  if (!one('SELECT id FROM playlists WHERE id = ? AND user_id = ?', playlistId, req.session.userId)) return res.status(404).json({ error: 'Playlist not found.' });
  run('DELETE FROM playlist_videos WHERE playlist_id = ? AND video_id = ?', playlistId, Number(req.params.videoId));
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Video or image must be smaller than 500 MB.' });
  res.status(400).json({ error: error.message || 'Something went wrong.' });
});

app.listen(PORT, () => console.log(`Frame is ready at http://localhost:${PORT}`));
