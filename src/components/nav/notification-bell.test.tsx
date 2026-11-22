import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock next/navigation before imports
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock socket client — suppress WebSocket connection during tests
// ---------------------------------------------------------------------------

vi.mock('@/lib/socket/client', () => ({
  useNotificationSocket: vi.fn(),
  SOCKET_EVENTS: {
    NOTIFICATION_NEW: 'notification:new',
  },
}));

// ---------------------------------------------------------------------------
// Mock all shadcn/ui components used by the bell
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...classes: (string | undefined | false | null)[]) => classes.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotificationsResponse(total: number, notifications = []) {
  return {
    notifications,
    total,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the bell icon button', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNotificationsResponse(0)),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { NotificationBell } = await import('./notification-bell');
    render(<NotificationBell userId="user-001" />);

    // The button with aria-label="Notifications" should always render
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    });
  });

  it('shows an unread badge when unread count is greater than 0', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNotificationsResponse(5)),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { NotificationBell } = await import('./notification-bell');
    render(<NotificationBell userId="user-001" />);

    await waitFor(() => {
      // Badge displays the numeric count
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('hides the badge when unread count is 0', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNotificationsResponse(0)),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { NotificationBell } = await import('./notification-bell');
    render(<NotificationBell userId="user-001" />);

    // Give fetch time to resolve and component to update
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Badge should not be present with count 0
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows 99+ when unread count exceeds 99', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNotificationsResponse(150)),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { NotificationBell } = await import('./notification-bell');
    render(<NotificationBell userId="user-001" />);

    await waitFor(() => {
      expect(screen.getByText('99+')).toBeInTheDocument();
    });
  });

  it('does not crash when fetch fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const { NotificationBell } = await import('./notification-bell');
    // Should render without throwing
    expect(() => render(<NotificationBell userId="user-001" />)).not.toThrow();
  });

  it('fetches with unreadOnly=true on mount to get the initial count', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeNotificationsResponse(3)),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { NotificationBell } = await import('./notification-bell');
    render(<NotificationBell userId="user-001" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('unreadOnly=true')
      );
    });
  });
});
