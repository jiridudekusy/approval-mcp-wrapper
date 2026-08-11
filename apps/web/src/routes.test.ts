import { describe, expect, it } from 'vitest';

import { pagePaths, routeFromLocation, routePath } from './routes.js';

describe('application routes', () => {
  it('maps every primary section to a stable path', () => {
    expect(pagePaths).toEqual({
      inbox: '/approvals',
      history: '/history',
      access: '/access',
      upstreams: '/upstreams',
      system: '/system',
    });
    expect(routeFromLocation({ pathname: '/history/', search: '' }))
      .toEqual({ page: 'history' });
  });

  it('round-trips approval detail routes', () => {
    const route = routeFromLocation({
      pathname: '/approvals/approval%201',
      search: '',
    });
    expect(route).toEqual({ page: 'inbox', approvalId: 'approval 1' });
    expect(routePath(route)).toBe('/approvals/approval%201');
  });

  it('keeps legacy notification links compatible', () => {
    expect(routeFromLocation({ pathname: '/', search: '?approval=approval-1' }))
      .toEqual({ page: 'inbox', approvalId: 'approval-1' });
    expect(routeFromLocation({ pathname: '/unknown', search: '' }))
      .toEqual({ page: 'inbox' });
  });
});
