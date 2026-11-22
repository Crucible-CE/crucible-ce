import { describe, it, expect } from 'vitest';
import { SOCKET_EVENTS } from './events';

describe('SOCKET_EVENTS', () => {
  it('NOTIFICATION_NEW has correct string value', () => {
    expect(SOCKET_EVENTS.NOTIFICATION_NEW).toBe('notification:new');
  });

  it('CHAT_MESSAGE has correct string value', () => {
    expect(SOCKET_EVENTS.CHAT_MESSAGE).toBe('chat:message');
  });

  it('INCIDENT_ACCESS_REVOKED has correct string value', () => {
    expect(SOCKET_EVENTS.INCIDENT_ACCESS_REVOKED).toBe('incident:access_revoked');
  });

  it('exports exactly 3 event constants', () => {
    expect(Object.keys(SOCKET_EVENTS)).toHaveLength(3);
  });

  it('all event values follow the namespace:action colon-separated convention', () => {
    for (const value of Object.values(SOCKET_EVENTS)) {
      expect(value).toMatch(/^[a-z-]+:[a-z_-]+$/);
    }
  });

  it('all event values are unique (no duplicates)', () => {
    const values = Object.values(SOCKET_EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });
});
