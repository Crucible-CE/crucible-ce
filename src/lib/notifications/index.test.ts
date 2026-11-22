import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/db before importing anything that depends on it
// ---------------------------------------------------------------------------

const mockNotification = {
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
};

vi.mock('@/lib/db', () => ({
  db: {
    notification: mockNotification,
  },
}));

// Mock the socket server — it is dynamically imported inside createNotification
vi.mock('@/lib/socket/server', () => ({
  getIO: vi.fn().mockReturnValue({
    to: vi.fn().mockReturnValue({
      emit: vi.fn(),
    }),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(overrides = {}) {
  return {
    id: 'notif-001',
    userId: 'user-001',
    type: 'system',
    title: 'Test notification',
    body: 'This is a test notification body.',
    metadata: null,
    read: false,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  beforeEach(() => {
    mockNotification.create.mockReset();
    mockNotification.findFirst.mockReset();
  });

  it('saves the notification to the DB and returns it', async () => {
    const expected = makeNotification({ type: 'system' });
    mockNotification.create.mockResolvedValueOnce(expected);

    const { createNotification } = await import('./index');
    const result = await createNotification('user-001', 'system', 'Test notification', 'Body text');

    expect(mockNotification.create).toHaveBeenCalledOnce();
    expect(mockNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-001',
          type: 'system',
          title: 'Test notification',
          body: 'Body text',
        }),
      })
    );
    expect(result).toEqual(expected);
  });

  it('delivers any notification type', async () => {
    const expected = makeNotification({ type: 'unknown_type' });
    mockNotification.create.mockResolvedValueOnce(expected);

    const { createNotification } = await import('./index');
    const result = await createNotification(
      'user-001',
      'unknown_type',
      'Custom event',
      'Something happened.'
    );

    expect(mockNotification.create).toHaveBeenCalledOnce();
    expect(result).toEqual(expected);
  });
});

describe('getUserNotifications', () => {
  beforeEach(() => {
    mockNotification.findMany.mockReset();
    mockNotification.count.mockReset();
  });

  it('returns paginated notifications and total count', async () => {
    const items = [makeNotification({ id: 'n-1' }), makeNotification({ id: 'n-2' })];
    mockNotification.findMany.mockResolvedValueOnce(items);
    mockNotification.count.mockResolvedValueOnce(5);

    const { getUserNotifications } = await import('./index');
    const result = await getUserNotifications('user-001', { limit: 2, offset: 0 });

    expect(result.notifications).toEqual(items);
    expect(result.total).toBe(5);
  });

  it('filters by unreadOnly when specified', async () => {
    mockNotification.findMany.mockResolvedValueOnce([]);
    mockNotification.count.mockResolvedValueOnce(0);

    const { getUserNotifications } = await import('./index');
    await getUserNotifications('user-001', { unreadOnly: true });

    const findManyCall = mockNotification.findMany.mock.calls[0][0];
    expect(findManyCall.where).toMatchObject({ read: false });
  });

  it('uses default limit of 20 and offset of 0', async () => {
    mockNotification.findMany.mockResolvedValueOnce([]);
    mockNotification.count.mockResolvedValueOnce(0);

    const { getUserNotifications } = await import('./index');
    await getUserNotifications('user-001');

    const findManyCall = mockNotification.findMany.mock.calls[0][0];
    expect(findManyCall.take).toBe(20);
    expect(findManyCall.skip).toBe(0);
  });

  it('orders results by createdAt descending', async () => {
    mockNotification.findMany.mockResolvedValueOnce([]);
    mockNotification.count.mockResolvedValueOnce(0);

    const { getUserNotifications } = await import('./index');
    await getUserNotifications('user-001');

    const findManyCall = mockNotification.findMany.mock.calls[0][0];
    expect(findManyCall.orderBy).toEqual({ createdAt: 'desc' });
  });
});

describe('markAsRead', () => {
  beforeEach(() => {
    mockNotification.findFirst.mockReset();
    mockNotification.update.mockReset();
  });

  it('updates the notification to read: true and returns it', async () => {
    const original = makeNotification({ id: 'notif-001', userId: 'user-001', read: false });
    const updated = { ...original, read: true };

    mockNotification.findFirst.mockResolvedValueOnce(original);
    mockNotification.update.mockResolvedValueOnce(updated);

    const { markAsRead } = await import('./index');
    const result = await markAsRead('notif-001', 'user-001');

    expect(result).toMatchObject({ read: true });
    expect(mockNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ read: true, readAt: expect.any(Date) }),
      })
    );
  });

  it('returns null when notification is not found or belongs to a different user', async () => {
    mockNotification.findFirst.mockResolvedValueOnce(null);

    const { markAsRead } = await import('./index');
    const result = await markAsRead('notif-999', 'user-001');

    expect(result).toBeNull();
    expect(mockNotification.update).not.toHaveBeenCalled();
  });
});

describe('markAllAsRead', () => {
  beforeEach(() => {
    mockNotification.updateMany.mockReset();
  });

  it('updates all unread notifications and returns the count', async () => {
    mockNotification.updateMany.mockResolvedValueOnce({ count: 7 });

    const { markAllAsRead } = await import('./index');
    const count = await markAllAsRead('user-001');

    expect(count).toBe(7);
    expect(mockNotification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-001', read: false },
        data: { read: true, readAt: expect.any(Date) },
      })
    );
  });

  it('returns 0 when there are no unread notifications', async () => {
    mockNotification.updateMany.mockResolvedValueOnce({ count: 0 });

    const { markAllAsRead } = await import('./index');
    const count = await markAllAsRead('user-001');

    expect(count).toBe(0);
  });
});
