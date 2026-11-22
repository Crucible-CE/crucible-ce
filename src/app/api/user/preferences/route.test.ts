import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/db
// ---------------------------------------------------------------------------

const mockUserPreferences = {
  upsert: vi.fn(),
};

vi.mock('@/lib/db', () => ({
  db: {
    userPreferences: mockUserPreferences,
  },
}));

// ---------------------------------------------------------------------------
// Mock @/lib/auth
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: mockAuth,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(userId = 'user-001') {
  return {
    user: {
      id: userId,
      email: 'analyst@crucible-ce.test',
      organizationId: 'org-001',
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

function makePreferences(overrides = {}) {
  return {
    id: 'prefs-001',
    userId: 'user-001',
    theme: 'dark',
    ...overrides,
  };
}

function makeJsonRequest(body: Record<string, unknown>, method = 'PATCH'): Request {
  return new Request('http://localhost/api/user/preferences', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests — GET
// ---------------------------------------------------------------------------

describe('GET /api/user/preferences', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockUserPreferences.upsert.mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null);

    const { GET } = await import('./route');
    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user.id', async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: 'x@x.com' } });

    const { GET } = await import('./route');
    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('returns existing preferences when user has them', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    const prefs = makePreferences({ theme: 'forge' });
    mockUserPreferences.upsert.mockResolvedValueOnce(prefs);

    const { GET } = await import('./route');
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.theme).toBe('forge');
  });

  it('creates default preferences when user has none (upsert with empty update)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('user-new-001'));
    const defaultPrefs = makePreferences({ userId: 'user-new-001' });
    mockUserPreferences.upsert.mockResolvedValueOnce(defaultPrefs);

    const { GET } = await import('./route');
    await GET();

    expect(mockUserPreferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-new-001' },
        create: { userId: 'user-new-001', theme: 'forge' },
        update: {},
      })
    );
  });

  it('returns all expected preference fields', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockUserPreferences.upsert.mockResolvedValueOnce(makePreferences());

    const { GET } = await import('./route');
    const response = await GET();

    const body = await response.json();
    expect(body).toHaveProperty('theme');
  });
});

// ---------------------------------------------------------------------------
// Tests — PATCH
// ---------------------------------------------------------------------------

describe('PATCH /api/user/preferences', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockUserPreferences.upsert.mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null);

    const { PATCH } = await import('./route');
    const response = await PATCH(makeJsonRequest({ theme: 'forge' }));

    expect(response.status).toBe(401);
  });

  it('updates preferences and returns the updated record', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    const updatedPrefs = makePreferences({ theme: 'forge' });
    mockUserPreferences.upsert.mockResolvedValueOnce(updatedPrefs);

    const { PATCH } = await import('./route');
    const response = await PATCH(makeJsonRequest({ theme: 'forge' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.theme).toBe('forge');
  });

  it('calls upsert with the correct update data', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('user-001'));
    mockUserPreferences.upsert.mockResolvedValueOnce(makePreferences());

    const { PATCH } = await import('./route');
    await PATCH(makeJsonRequest({ theme: 'system' }));

    expect(mockUserPreferences.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-001' },
        update: expect.objectContaining({ theme: 'system' }),
      })
    );
  });

  it('returns 400 when request body fails validation (non-string theme)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());

    const { PATCH } = await import('./route');
    const response = await PATCH(makeJsonRequest({ theme: 42 as unknown as string }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when theme value is unsupported', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());

    const { PATCH } = await import('./route');
    const response = await PATCH(makeJsonRequest({ theme: 'retro-wave' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  it('accepts a partial update (only some fields provided)', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockUserPreferences.upsert.mockResolvedValueOnce(makePreferences({ theme: 'dark' }));

    const { PATCH } = await import('./route');
    // Only updating theme
    const response = await PATCH(makeJsonRequest({ theme: 'dark' }));

    expect(response.status).toBe(200);
  });

  it('handles empty body (no changes) without error', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockUserPreferences.upsert.mockResolvedValueOnce(makePreferences());

    const { PATCH } = await import('./route');
    const response = await PATCH(makeJsonRequest({}));

    expect(response.status).toBe(200);
  });
});
