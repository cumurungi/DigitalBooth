import { useEffect, useMemo, useState } from 'react';
import type { BoothEntry, EntryKind } from './types';
import Confetti from './Confetti';

const STORAGE_KEY = 'digital-wedding-booth-entries';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const API_URL = `${API_BASE_URL}/api/entries`;
const COUPLE_LOGIN_URL = `${API_BASE_URL}/api/couple/login`;
const COUPLE_TOKEN_KEY = 'digital-wedding-booth-couple-token';
const COUPLE_NAMES = 'Charmante & Fabrice';
const WEDDING_DATE = 'May 28, 2026';

const categoryKeywords: Record<string, string[]> = {
  Love: ['love', 'forever', 'heart', 'cherish', 'together', 'soul'],
  Advice: ['advice', 'tips', 'learn', 'remember', 'promise', 'grow'],
  Blessings: ['blessing', 'bless', 'joy', 'wish', 'happy', 'prosper'],
  Family: ['family', 'parents', 'kids', 'home', 'support', 'relatives'],
  Future: ['future', 'tomorrow', 'next', 'dream', 'goal', 'journey'],
  Fun: ['fun', 'laugh', 'party', 'smile', 'memory', 'celebrate'],
};

const getCategory = (text: string) => {
  const normalized = text.toLowerCase();
  for (const [category, words] of Object.entries(categoryKeywords)) {
    if (words.some((word) => normalized.includes(word))) {
      return category;
    }
  }
  return 'Memories';
};

const initialFormState = {
  kind: 'photo' as EntryKind,
  title: '',
  guestName: '',
  text: '',
  mediaName: '',
  mediaFile: null as File | null,
};

function App() {
  const [form, setForm] = useState(initialFormState);
  const [entries, setEntries] = useState<BoothEntry[]>([]);
  const [memoryView, setMemoryView] = useState(() => window.location.pathname === '/memory-book');
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [backendReady, setBackendReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [coupleToken, setCoupleToken] = useState(() => localStorage.getItem(COUPLE_TOKEN_KEY) || '');
  const [passcode, setPasscode] = useState('');
  const [authError, setAuthError] = useState('');
  const [submittedMemory, setSubmittedMemory] = useState(false);

  // Filtered entries based on search term
  const filteredEntries = useMemo(() => {
    if (!searchTerm) return entries;
    const lowerSearch = searchTerm.toLowerCase();
    return entries.filter(entry => 
      entry.guestName?.toLowerCase().includes(lowerSearch) ||
      entry.title.toLowerCase().includes(lowerSearch) ||
      entry.text.toLowerCase().includes(lowerSearch)
    );
  }, [entries, searchTerm]);

  const filteredCategories = useMemo(() => {
    const grouped: Record<string, BoothEntry[]> = {};
    for (const entry of filteredEntries) {
      grouped[entry.category] = grouped[entry.category] || [];
      grouped[entry.category].push(entry);
    }
    return grouped;
  }, [filteredEntries]);

  const filteredCounts = useMemo(() => {
    return filteredEntries.reduce(
      (acc, entry) => {
        acc[entry.kind] = (acc[entry.kind] || 0) + 1;
        return acc;
      },
      {} as Record<EntryKind, number>
    );
  }, [filteredEntries]);

  const filteredSummary = useMemo(() => {
    if (filteredEntries.length === 0) {
      return 'Be the first to leave a memory for the couple ❤️';
    }

    const parts: string[] = [];
    if (filteredCounts.video) parts.push(`${filteredCounts.video} videos`);
    if (filteredCounts.photo) parts.push(`${filteredCounts.photo} photos`);

    return `Your memory book contains ${parts.join(', ') || 'beautiful memories'}.`;
  }, [filteredCounts, filteredEntries.length]);

  useEffect(() => {
    setSiteUrl(window.location.href);
  }, []);

  useEffect(() => {
    const handleRouteChange = () => {
      setMemoryView(window.location.pathname === '/memory-book');
    };

    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, []);

  useEffect(() => {
    if (!memoryView || !coupleToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(API_URL, {
      headers: {
        Authorization: `Bearer ${coupleToken}`,
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Couple access required');
        }
        return response.json();
      })
      .then((data: BoothEntry[]) => {
        setEntries(data);
        setBackendReady(true);
        setAuthError('');
      })
      .catch(() => {
        localStorage.removeItem(COUPLE_TOKEN_KEY);
        setCoupleToken('');
        setEntries([]);
        setAuthError('Please enter the couple passcode to open the memory book.');
      })
      .finally(() => setLoading(false));
  }, [coupleToken, memoryView]);

  useEffect(() => {
    if (!backendReady) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }
  }, [entries, backendReady]);

  useEffect(() => {
    if (!form.mediaFile) {
      setPreviewUrl(undefined);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(form.mediaFile);
  }, [form.mediaFile]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!form.title.trim() && !form.text.trim() && !form.mediaFile) {
      return;
    }

    setIsSubmitting(true);

    const entryBase = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: form.kind,
      guestName: form.guestName.trim() || undefined,
      title:
        form.title.trim() ||
        (form.kind === 'photo'
          ? 'Wedding photo'
          : `${form.kind.charAt(0).toUpperCase() + form.kind.slice(1)} message`),
      text: form.text.trim(),
      category: getCategory(form.text || form.title || form.guestName),
      createdAt: new Date().toISOString(),
      mediaName: form.mediaFile?.name,
      mediaType:
        form.kind === 'video'
          ? 'video'
          : form.kind === 'photo'
            ? 'image'
            : undefined,
    };

    let entryToSave: BoothEntry = {
      ...entryBase,
      mediaUrl: previewUrl,
    } as BoothEntry;

    const trySaveBackend = async () => {
      const formData = new FormData();
      Object.entries(entryBase).forEach(([key, value]) => {
        if (value !== undefined) {
          formData.append(key, String(value));
        }
      });

      if (form.mediaFile) {
        formData.append('media', form.mediaFile);
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Unable to save to backend');
      }

      return (await response.json()) as BoothEntry;
    };

    try {
      const saved = await trySaveBackend();
      entryToSave = saved;
      setBackendReady(true);
    } catch {
      setBackendReady(false);
    } finally {
      setEntries((prev) => [entryToSave, ...prev]);
      setSubmittedMemory(true);
      setShowCelebration(true);
      setTimeout(() => setShowCelebration(false), 1200);
      setForm(initialFormState);
      setIsSubmitting(false);
    }
  };

  const navigateToMemoryBook = () => {
    window.history.pushState({}, '', '/memory-book');
    setMemoryView(true);
  };

  const navigateToBooth = () => {
    window.history.pushState({}, '', '/');
    setMemoryView(false);
  };

  const handleCoupleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');

    try {
      const response = await fetch(COUPLE_LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });

      if (!response.ok) {
        throw new Error('Unable to open memory book');
      }

      const data = (await response.json()) as { token: string };
      localStorage.setItem(COUPLE_TOKEN_KEY, data.token);
      setCoupleToken(data.token);
      setPasscode('');
    } catch {
      setAuthError('That passcode did not work. Please try again.');
    }
  };

  const qrCodeUrl = siteUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=10&data=${encodeURIComponent(siteUrl)}`
    : '';

  return (
    <div className="app-shell">
      <Confetti trigger={showCelebration} />
      <header className="hero-panel">
        <div className="hero-content">
          <p className="eyebrow">Wedding Memory Book</p>
          <h1>{COUPLE_NAMES}</h1>
          <p className="wedding-date">{WEDDING_DATE}</p>
          <p className="hero-romance">A little place for every memory, blessing, and moment we will carry forever.</p>
          <p className="hero-purpose">
            Didn’t get time to speak or take a photo at the wedding? Leave your memory, blessing, or special moment here for us ❤️
          </p>
          <p className="hero-soft-note">
            We wanted everyone to have a space to share memories with us even after the celebration.
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" className="memory-btn" onClick={memoryView ? navigateToBooth : navigateToMemoryBook}>
            {memoryView ? 'Back to Blessings' : 'Couple Memory Book'}
          </button>
        </div>
      </header>

      {memoryView && !coupleToken ? (
        <main className="memory-book access-panel">
          <form onSubmit={handleCoupleLogin} className="booth-form">
            <div className="form-header">
              <p className="form-label">Private Memory Book</p>
              <p className="preview-note">This page is just for the couple to read every memory shared by guests.</p>
            </div>
            <input
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              aria-label="Couple passcode"
              placeholder="Enter couple passcode"
              className="form-input"
            />
            {authError && <p className="auth-error">{authError}</p>}
            <button type="submit" className="submit-btn">Open Memory Book</button>
          </form>
        </main>
      ) : memoryView ? (
        <main className="memory-book">
          <section className="memory-summary">
            <div className="summary-content">
              <p className="eyebrow">Your Wedding Memories</p>
              <h2>Forever captured</h2>
              <p>{filteredSummary}</p>
            </div>
            <div className="search-section">
              <input
                type="text"
                placeholder="Search names (Charmante, Fabrice)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-emoji">📸</span>
                <span className="stat-count">{filteredCounts.photo || 0}</span>
                <p>Photos</p>
              </div>
              <div className="stat-card">
                <span className="stat-emoji">🎥</span>
                <span className="stat-count">{filteredCounts.video || 0}</span>
                <p>Videos</p>
              </div>
              <div className="stat-card">
                <span className="stat-emoji">💾</span>
                <span className="stat-count">{filteredEntries.length}</span>
                <p>Total</p>
              </div>
            </div>
          </section>

          {filteredEntries.length === 0 ? (
            <p className="empty-state">Be the first to leave a memory for the couple ❤️</p>
          ) : (
            Object.entries(filteredCategories).map(([category, items]) => (
              <section key={category} className="category-section">
                <div className="section-heading">
                  <h3>{category}</h3>
                  <span>{items.length} item{items.length > 1 ? 's' : ''}</span>
                </div>
                <div className="entry-grid">
                  {items.map((entry) => (
                    <article key={entry.id} className="entry-card">
                      <div className="entry-labels">
                        <span className="entry-emoji">
                          {entry.kind === 'video' && '🎬'}
                          {entry.kind === 'photo' && '📸'}
                        </span>
                        {entry.guestName && <span className="entry-guest">From {entry.guestName}</span>}
                      </div>
                      <strong>{entry.title}</strong>
                      <p>{entry.text || <em>A memory was shared with love.</em>}</p>
                      {entry.mediaUrl && entry.mediaType === 'image' && (
                        <img src={entry.mediaUrl} alt={entry.mediaName || entry.title} />
                      )}
                      {entry.mediaUrl && entry.mediaType === 'video' && (
                        <video controls src={entry.mediaUrl} />
                      )}
                      <span className="meta">{new Date(entry.createdAt).toLocaleString()}</span>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      ) : (
        <main className="booth-grid">
          <section className="form-panel">
            <form onSubmit={handleSubmit} className="booth-form">
              <div className="form-header">
                <p className="form-label">Leave Your Blessing</p>
                <div className="type-grid">
                  {[
                    { value: 'photo', emoji: '📸', label: 'Photo' },
                    { value: 'video', emoji: '🎬', label: 'Video' },
                  ].map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      className={`type-btn ${form.kind === type.value ? 'active' : ''}`}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, kind: type.value as EntryKind, mediaFile: null }))
                      }
                    >
                      <span className="type-emoji">{type.emoji}</span>
                      <span className="type-label">{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <input
                type="text"
                value={form.guestName}
                onChange={(event) => setForm((prev) => ({ ...prev, guestName: event.target.value }))}
                aria-label="Your Name"
                placeholder="Your Name"
                className="form-input"
              />

              <input
                type="text"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                aria-label="Memory Title"
                placeholder="A title for your memory"
                className="form-input"
              />

              <textarea
                value={form.text}
                onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
                aria-label="Your Blessing"
                placeholder="Share a memory, blessing, or something you wanted to tell us..."
                className="form-input form-textarea"
              />

              {(form.kind === 'video' || form.kind === 'photo') && (
                <label className="file-label">
                  Add a {form.kind}
                  <input
                    type="file"
                    accept={form.kind === 'video' ? 'video/*' : 'image/*'}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, mediaFile: event.target.files?.[0] ?? null }))
                    }
                  />
                </label>
              )}

              {previewUrl && (
                <div className="media-preview">
                  {form.kind === 'photo' && <img src={previewUrl} alt="Preview" />}
                  {form.kind === 'video' && <video controls src={previewUrl} />}
                </div>
              )}

              <p className="form-note">Your message will become part of our wedding memories forever ❤️</p>

              <button type="submit" className="submit-btn" disabled={isSubmitting}>Send Your Blessing</button>
            </form>
          </section>

          <section className="preview-panel">
            <div className="preview-card">
              <h2 className="preview-title">Latest memories</h2>
              <p className="preview-note">A gentle glimpse of the love being shared.</p>
              {entries.length === 0 ? (
                <p className="empty-preview">Be the first to leave a memory for the couple ❤️</p>
              ) : (
                <div className="entry-list">
                  {entries.slice(0, 6).map((entry) => (
                    <article key={entry.id} className="entry-snippet">
                      <div className="snippet-header">
                        <strong>{entry.title}</strong>
                      </div>
                      {entry.guestName && <p className="snippet-guest">From {entry.guestName}</p>}
                      <p className="snippet-text">{entry.text || <em>Media shared with love.</em>}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      <section className="couple-note" aria-label="A note from the couple">
        <img src="/wedding.jpeg" alt={`${COUPLE_NAMES} wedding moment`} />
        <div>
          <p className="couple-note-names">{COUPLE_NAMES}</p>
          <p>Thank you for celebrating this beautiful day with us.</p>
        </div>
      </section>

      <section className="qr-section" aria-label="QR code">
        <p>Scan to leave your memory with us</p>
        {qrCodeUrl && <img src={qrCodeUrl} alt="QR code to leave a wedding memory" />}
      </section>

      <footer className="site-footer">Made with love for our wedding day ❤️</footer>
    </div>
  );
}

export default App;
