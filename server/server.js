import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(__dirname, 'data');
const entriesPath = path.join(dataDir, 'entries.json');
const uploadDir = path.join(__dirname, 'uploads');

async function loadLocalEnv() {
  const envPath = path.join(rootDir, '.env');
  try {
    const raw = await fs.readFile(envPath, 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const separator = trimmed.indexOf('=');
      if (separator === -1) continue;

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // A .env file is optional; deployed hosts usually provide real environment variables.
  }
}

await loadLocalEnv();

const couplePasscode = process.env.COUPLE_ACCESS_CODE;
const sessionSecret = process.env.COUPLE_SESSION_SECRET || process.env.COUPLE_ACCESS_CODE;
const sessionDurationMs = 1000 * 60 * 60 * 12;
const port = process.env.PORT || 4000;
const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL || `http://localhost:${port}`;
const mysqlEnabled = Boolean(process.env.DATABASE_URL || process.env.MYSQL_HOST);

let bucket = null;
let db = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_STORAGE_BUCKET) {
  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      });
    }
    bucket = getStorage().bucket();
  } catch (e) {
    console.error('Firebase initialization failed:', e.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

const upload = multer({ storage: multer.memoryStorage() });

async function ensureStorage() {
  await fs.mkdir(uploadDir, { recursive: true });

  if (mysqlEnabled) {
    const { createPool } = await import('mysql2/promise');
    db = process.env.DATABASE_URL
      ? createPool(process.env.DATABASE_URL)
      : createPool({
          host: process.env.MYSQL_HOST,
          port: Number(process.env.MYSQL_PORT || 3306),
          user: process.env.MYSQL_USER,
          password: process.env.MYSQL_PASSWORD,
          database: process.env.MYSQL_DATABASE,
          waitForConnections: true,
          connectionLimit: 10,
        });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS memories (
        id VARCHAR(80) PRIMARY KEY,
        kind ENUM('photo', 'video') NOT NULL,
        guest_name VARCHAR(255) NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NULL,
        category VARCHAR(80) NOT NULL DEFAULT 'Memories',
        created_at DATETIME(3) NOT NULL,
        media_name VARCHAR(255) NULL,
        media_url LONGTEXT NULL,
        media_type ENUM('image', 'video', 'audio') NULL,
        created_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_memories_created_at (created_at),
        INDEX idx_memories_kind (kind),
        INDEX idx_memories_category (category)
      )
    `);
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(entriesPath);
  } catch {
    await fs.writeFile(entriesPath, JSON.stringify([]));
  }
}

async function readEntries() {
  if (db) {
    const [rows] = await db.execute(`
      SELECT
        id,
        kind,
        guest_name AS guestName,
        title,
        message AS text,
        category,
        created_at AS createdAt,
        media_name AS mediaName,
        media_url AS mediaUrl,
        media_type AS mediaType
      FROM memories
      ORDER BY created_at DESC
    `);

    return rows.map((entry) => ({
      ...entry,
      guestName: entry.guestName || undefined,
      mediaName: entry.mediaName || undefined,
      mediaUrl: entry.mediaUrl || undefined,
      mediaType: entry.mediaType || undefined,
      createdAt: new Date(entry.createdAt).toISOString(),
    }));
  }

  const raw = await fs.readFile(entriesPath, 'utf-8');
  return JSON.parse(raw);
}

async function writeEntries(entries) {
  await fs.writeFile(entriesPath, JSON.stringify(entries, null, 2));
}

async function saveEntry(entry) {
  if (db) {
    await db.execute(
      `
        INSERT INTO memories (
          id,
          kind,
          guest_name,
          title,
          message,
          category,
          created_at,
          media_name,
          media_url,
          media_type
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        entry.id,
        entry.kind,
        entry.guestName || null,
        entry.title,
        entry.text || null,
        entry.category,
        new Date(entry.createdAt),
        entry.mediaName || null,
        entry.mediaUrl || null,
        entry.mediaType || null,
      ],
    );
    return;
  }

  const entries = await readEntries();
  entries.unshift(entry);
  await writeEntries(entries);
}

async function saveMedia(file) {
  if (!file) return undefined;

  const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-')}`;

  if (bucket) {
    const storageFile = bucket.file(filename);
    await storageFile.save(file.buffer, {
      metadata: { contentType: file.mimetype },
      public: true,
    });
    return `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filename)}`;
  }

  if (db) {
    return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  }

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, filename), file.buffer);
  return `${publicApiBaseUrl}/uploads/${encodeURIComponent(filename)}`;
}

function signSession(expiresAt) {
  return crypto
    .createHmac('sha256', sessionSecret)
    .update(String(expiresAt))
    .digest('hex');
}

function createSessionToken() {
  const expiresAt = Date.now() + sessionDurationMs;
  return `${expiresAt}.${signSession(expiresAt)}`;
}

function verifySessionToken(token) {
  if (!sessionSecret || !token) return false;
  const [expiresAtRaw, signature] = token.split('.');
  const expiresAt = Number(expiresAtRaw);
  if (!expiresAt || !signature || expiresAt < Date.now()) return false;
  const expected = signSession(expiresAt);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function requireCoupleAccess(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!verifySessionToken(token)) {
    res.status(401).json({ error: 'Couple access required' });
    return;
  }
  next();
}

app.post('/api/couple/login', (req, res) => {
  if (!couplePasscode || !sessionSecret) {
    res.status(503).json({ error: 'Couple access is not configured' });
    return;
  }

  const passcode = String(req.body?.passcode || '');
  const valid =
    passcode.length === couplePasscode.length &&
    crypto.timingSafeEqual(Buffer.from(passcode), Buffer.from(couplePasscode));

  if (!valid) {
    res.status(401).json({ error: 'Incorrect passcode' });
    return;
  }

  res.json({ token: createSessionToken() });
});

app.get('/api/entries', requireCoupleAccess, async (req, res) => {
  try {
    const entries = await readEntries();
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load entries' });
  }
});

app.post('/api/entries', upload.single('media'), async (req, res) => {
  try {
    const { id, kind, guestName, title, text, category, createdAt, mediaType } = req.body;

    let mediaUrl = req.body.mediaUrl;
    if (req.file) {
      mediaUrl = await saveMedia(req.file);
    }

    const newEntry = {
      id,
      kind,
      guestName: guestName || undefined,
      title,
      text,
      category,
      createdAt,
      mediaName: req.file?.originalname || req.body.mediaName,
      mediaUrl,
      mediaType,
    };

    await saveEntry(newEntry);
    res.status(201).json(newEntry);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save entry' });
  }
});

ensureStorage().then(() => {
  app.listen(port, () => {
    console.log(`Wedding booth backend listening on http://localhost:${port}`);
  });
});
