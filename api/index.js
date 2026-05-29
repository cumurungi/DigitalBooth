const crypto = require('crypto');

const couplePasscode = process.env.COUPLE_ACCESS_CODE;
const sessionSecret = process.env.COUPLE_SESSION_SECRET || process.env.COUPLE_ACCESS_CODE;
const sessionDurationMs = 1000 * 60 * 60 * 12;

function signSession(expiresAt) {
  return crypto.createHmac('sha256', sessionSecret).update(String(expiresAt)).digest('hex');
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
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(signSession(expiresAt)));
}

async function getConnection() {
  if (!process.env.MYSQL_HOST) return null;
  const mysql = require('mysql2/promise');
  return mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectTimeout: 5000,
    ssl: { rejectUnauthorized: true },
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.url === '/api/couple/login' && req.method === 'POST') {
    const body = req.body || {};
    if (!couplePasscode || !sessionSecret) {
      return res.status(503).json({ error: 'Couple access is not configured' });
    }
    const passcode = String(body.passcode || '');
    const valid =
      passcode.length === couplePasscode.length &&
      crypto.timingSafeEqual(Buffer.from(passcode), Buffer.from(couplePasscode));
    if (!valid) return res.status(401).json({ error: 'Incorrect passcode' });
    return res.json({ token: createSessionToken() });
  }

  if (req.url === '/api/entries' && req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    if (!verifySessionToken(token)) {
      return res.status(401).json({ error: 'Couple access required' });
    }

    let conn;
    try {
      conn = await getConnection();
      if (!conn) {
        return res.json([]);
      }

      await conn.execute(`
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
          media_type ENUM('image', 'video', 'audio') NULL
        )
      `);

      const [rows] = await conn.execute(`
        SELECT id, kind, guest_name AS guestName, title, message AS text, category,
          created_at AS createdAt, media_name AS mediaName, media_url AS mediaUrl, media_type AS mediaType
        FROM memories
        ORDER BY created_at DESC
      `);

      return res.json(rows.map((e) => ({
        ...e,
        guestName: e.guestName || undefined,
        createdAt: new Date(e.createdAt).toISOString(),
      })));
    } catch (err) {
      console.error('DB error:', err.message);
      return res.status(500).json({ error: 'Database error: ' + err.message });
    } finally {
      if (conn) await conn.end();
    }
  }

  if (req.url === '/api/entries' && req.method === 'POST') {
    const { id, kind, guestName, title, text, category, createdAt, mediaType, mediaUrl } = req.body || {};

    const newEntry = {
      id: id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: kind || 'photo',
      guestName,
      title: title || 'Memory',
      text: text || '',
      category: category || 'Memories',
      createdAt: createdAt || new Date().toISOString(),
      mediaName: req.body?.mediaName,
      mediaUrl,
      mediaType,
    };

    let conn;
    try {
      conn = await getConnection();
      if (conn) {
        await conn.execute(
          `INSERT INTO memories (id, kind, guest_name, title, message, category, created_at, media_name, media_url, media_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newEntry.id, newEntry.kind, newEntry.guestName || null, newEntry.title, newEntry.text || null,
            newEntry.category, new Date(newEntry.createdAt), newEntry.mediaName || null, newEntry.mediaUrl || null, newEntry.mediaType || null,
          ],
        );
      }
    } catch (err) {
      console.error('Save error:', err.message);
      return res.status(500).json({ error: 'Save error: ' + err.message });
    } finally {
      if (conn) await conn.end();
    }

    return res.status(201).json(newEntry);
  }

  res.status(404).json({ error: 'Not found' });
};