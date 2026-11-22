import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/notifications
// ---------------------------------------------------------------------------

const mockGetUserNotifications = vi.fn();

vi.mock('@/lib/notifications', () => ({
  getUserNotifications: mockGetUserNotifications,
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

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL('http://localhost/api/notifications');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

function makeNotification(overrides = {}) {
  return {
    id: 'notif-001',
    userId: 'user-001',
    type: 'system',
    title: 'Test Notification',
    body: 'Body text here.',
    metadata: null,
    read: false,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/notifications', () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockGetUserNotifications.mockReset();
  });

  it('returns 401 when there is no authenticated session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    const { GET } = await import('./route');
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 401 when session has no user.id', async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: 'x@x.com' } });

    const { GET } = await import('./route');
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
  });

  it('returns a notifications array when authenticated', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    const notifications = [makeNotification(), makeNotification({ id: 'notif-002' })];
    mockGetUserNotifications.mockResolvedValueOnce({ notifications, total: 2 });

    const { GET } = await import('./route');
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(body.notifications).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('passes unreadOnly=true to getUserNotifications when param is set', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockGetUserNotifications.mockResolvedValueOnce({ notifications: [], total: 0 });

    const { GET } = await import('./route');
    await GET(makeRequest({ unreadOnly: 'true' }));

    expect(mockGetUserNotifications).toHaveBeenCalledWith(
      'user-001',
      expect.objectContaining({ unreadOnly: true })
    );
  });

  it('passes unreadOnly=false when param is not "true"', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockGetUserNotifications.mockResolvedValueOnce({ notifications: [], total: 0 });

    const { GET } = await import('./route');
    await GET(makeRequest({ unreadOnly: 'false' }));

    expect(mockGetUserNotifications).toHaveBeenCalledWith(
      'user-001',
      expect.objectContaining({ unreadOnly: false })
    );
  });

  it('respects the limit query param', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockGetUserNotifications.mockResolvedValueOnce({ notifications: [], total: 0 });

    const { GET } = await import('./route');
    await GET(makeRequest({ limit: '5' }));

    expect(mockGetUserNotifications).toHaveBeenCalledWith(
      'user-001',
      expect.objectContaining({ limit: 5 })
    );
  });

  it('caps limit at 100', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockGetUserNotifications.mockResolvedValueOnce({ notifications: [], total: 0 });

    const { GET } = await import('./route');
    await GET(makeRequest({ limit: '500' }));

    expect(mockGetUserNotifications).toHaveBeenCalledWith(
      'user-001',
      expect.objectContaining({ limit: 100 })
    );
  });

  it('defaults to limit 20 and offset 0 when no params provided', async () => {
    mockAuth.mockResolvedValueOnce(makeSession());
    mockGetUserNotifications.mockResolvedValueOnce({ notifications: [], total: 0 });

    const { GET } = await import('./route');
    await GET(makeRequest());

    expect(mockGetUserNotifications).toHaveBeenCalledWith(
      'user-001',
      expect.objectContaining({ limit: 20, offset: 0 })
    );
  });

  it('passes the authenticated user id to getUserNotifications', async () => {
    mockAuth.mockResolvedValueOnce(makeSession('user-specific-abc'));
    mockGetUserNotifications.mockResolvedValueOnce({ notifications: [], total: 0 });

    const { GET } = await import('./route');
    await GET(makeRequest());

    expect(mockGetUserNotifications).toHaveBeenCalledWith('user-specific-abc', expect.any(Object));
  });
});
