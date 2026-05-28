const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const crypto = require('crypto');

admin.initializeApp();

const bucket = getStorage().bucket();
const db = admin.firestore();
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });
const couplePasscode = process.env.COUPLE_ACCESS_CODE;
const sessionSecret = process.env.COUPLE_SESSION_SECRET || process.env.COUPLE_ACCESS_CODE;
const sessionDurationMs = 1000 * 60 * 60 * 12;

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
    const snapshot = await db.collection('entries').orderBy('createdAt', 'desc').get();
    const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(entries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to load entries' });
  }
});

app.post('/api/entries', upload.single('media'), async (req, res) => {
  try {
    const { id, kind, guestName, title, text, category, createdAt, mediaType } = req.body;

    let mediaUrl = req.body.mediaUrl;
    if (req.file) {
      const filename = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      const file = bucket.file(filename);
      await file.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
        public: true,
      });
      mediaUrl = `https://storage.googleapis.com/${bucket.name}/${encodeURIComponent(filename)}`;
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

    await db.collection('entries').add(newEntry);
    const snapshot = await db.collection('entries').orderBy('createdAt', 'desc').limit(1).get();
    const saved = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    res.status(201).json(saved);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to save entry' });
  }
});

exports.api = functions.https.onRequest(app);
