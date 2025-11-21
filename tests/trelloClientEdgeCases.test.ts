import { TrelloClient } from '../src/trello/client';
import { jest } from '@jest/globals';

describe('TrelloClient Edge Cases', () => {
  let client: TrelloClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    client = new TrelloClient({
      apiKey: 'test-api-key',
      token: 'test-token'
    });
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
    }
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
        new TypeError('Failed to fetch')
      );

      await expect(client.getMyBoards()).rejects.toMatchObject({
        message: 'Network error - unable to reach Trello API',
        code: 'NETWORK_ERROR'
      });
    });

    it('should handle timeout errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => 
        new Promise((_, reject) => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        })
      );

      await expect(client.getMyBoards()).rejects.toMatchObject({
        message: 'Request timeout - Trello API did not respond in time',
        code: 'TIMEOUT_ERROR'
      });
    });

    it('should handle 401 unauthorized errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers()
      } as Response);

      await expect(client.getMyBoards()).rejects.toMatchObject({
        message: expect.stringContaining('Invalid or expired Trello credentials'),
        status: 401,
        code: 'INVALID_CREDENTIALS'
      });
    });

    it('should handle 403 forbidden errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers()
      } as Response);

      await expect(client.getMyBoards()).rejects.toMatchObject({
        message: expect.stringContaining('Insufficient permissions'),
        status: 403,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    });

    it('should handle 404 not found errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers()
      } as Response);

      await expect(client.getBoard('nonexistent')).rejects.toMatchObject({
        message: 'Resource not found',
        status: 404,
        code: 'NOT_FOUND'
      });
    });

    it('should handle 429 rate limit errors with retry', async () => {
      let callCount = 0;
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'retry-after': '1' })
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers()
        } as Response);
      });

      const result = await client.getMyBoards();
      expect(result.data).toEqual([]);
      expect(callCount).toBeGreaterThan(1);
    });

    it('should handle 500 server errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers()
      } as Response);

      await expect(client.getMyBoards()).rejects.toMatchObject({
        message: 'Trello server error',
        status: 500,
        code: 'SERVER_ERROR'
      });
    });

    it('should handle unknown errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
        'Unknown error'
      );

      await expect(client.getMyBoards()).rejects.toMatchObject({
        message: 'Unknown error occurred',
        code: 'UNKNOWN_ERROR'
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should extract rate limit information from headers', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers({
          'x-rate-limit-api-key-limit': '300',
          'x-rate-limit-api-key-remaining': '250',
          'x-rate-limit-api-key-reset': '1234567890'
        })
      } as Response);

      const result = await client.getMyBoards();
      expect(result.rateLimit).toEqual({
        limit: 300,
        remaining: 250,
        resetTime: 1234567890
      });
    });

    it('should handle missing rate limit headers', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers()
      } as Response);

      const result = await client.getMyBoards();
      expect(result.rateLimit).toBeUndefined();
    });
  });

  describe('Retry Logic', () => {
    it('should retry on network errors', async () => {
      let callCount = 0;
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers()
        } as Response);
      });

      const result = await client.getMyBoards();
      expect(result.data).toEqual([]);
      expect(callCount).toBe(3);
    });

    it('should eventually fail after retrying on 500 errors', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers()
      } as Response);

      // Should throw error after all retries are exhausted
      await expect(client.getMyBoards()).rejects.toMatchObject({
        message: 'Trello server error',
        status: 500,
        code: 'SERVER_ERROR'
      });
    });

    it('should not retry on 404 errors', async () => {
      let callCount = 0;
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          headers: new Headers()
        } as Response);
      });

      await expect(client.getBoard('nonexistent')).rejects.toMatchObject({
        status: 404
      });
      expect(callCount).toBe(1);
    });

    it('should exhaust retries and throw error', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
        new TypeError('Failed to fetch')
      );

      await expect(client.getMyBoards()).rejects.toMatchObject({
        code: 'NETWORK_ERROR'
      });
    });
  });

  describe('Query Parameters', () => {
    it('should handle optional filter parameters', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('filter')).toBe('closed');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers()
        } as Response);
      });

      await client.getMyBoards('closed');
    });

    it('should handle search with multiple options', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('modelTypes')).toBe('cards,boards');
        expect(urlObj.searchParams.get('cards_limit')).toBe('50');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          headers: new Headers()
        } as Response);
      });

      await client.search('test query', {
        modelTypes: ['cards', 'boards'],
        cardsLimit: 50
      });
    });

    it('should handle list cards with filter options', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('filter')).toBe('open');
        expect(urlObj.searchParams.get('fields')).toBe('name,desc,id');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers()
        } as Response);
      });

      await client.getListCards('list-id', {
        filter: 'open',
        fields: ['name', 'desc', 'id']
      });
    });
  });

  describe('HTTP Methods', () => {
    it('should use POST for createCard', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
        expect(init?.method).toBe('POST');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'new-card' }),
          headers: new Headers()
        } as Response);
      });

      await client.createCard({
        name: 'Test Card',
        idList: 'list-id'
      });
    });

    it('should use PUT for updateCard', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
        expect(init?.method).toBe('PUT');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'updated-card' }),
          headers: new Headers()
        } as Response);
      });

      await client.updateCard('card-id', {
        name: 'Updated Name'
      });
    });

    it('should use DELETE for deleteCard', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url, init) => {
        expect(init?.method).toBe('DELETE');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          headers: new Headers()
        } as Response);
      });

      await client.deleteCard('card-id');
    });
  });

  describe('Card Operations with Details', () => {
    it('should request additional details when includeDetails is true', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('members')).toBe('true');
        expect(urlObj.searchParams.get('labels')).toBe('true');
        expect(urlObj.searchParams.get('checklists')).toBe('all');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'card-id' }),
          headers: new Headers()
        } as Response);
      });

      await client.getCard('card-id', true);
    });

    it('should request board details with lists and cards', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('lists')).toBe('open');
        expect(urlObj.searchParams.get('cards')).toBe('open');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'board-id' }),
          headers: new Headers()
        } as Response);
      });

      await client.getBoard('board-id', true);
    });
  });

  describe('Advanced API Methods', () => {
    it('should get card actions with filters', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('filter')).toBe('commentCard');
        expect(urlObj.searchParams.get('limit')).toBe('10');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers()
        } as Response);
      });

      await client.getCardActions('card-id', {
        filter: 'commentCard',
        limit: 10
      });
    });

    it('should get card attachments with specific fields', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('fields')).toBe('name,url,mimeType');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers()
        } as Response);
      });

      await client.getCardAttachments('card-id', {
        fields: ['name', 'url', 'mimeType']
      });
    });

    it('should get card checklists with check items', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('checkItems')).toBe('all');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers()
        } as Response);
      });

      await client.getCardChecklists('card-id', {
        checkItems: 'all'
      });
    });

    it('should get member with custom options', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url) => {
        const urlObj = new URL(url.toString());
        expect(urlObj.searchParams.get('boards')).toBe('open');
        expect(urlObj.searchParams.get('organizations')).toBe('all');
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 'member-id' }),
          headers: new Headers()
        } as Response);
      });

      await client.getMember('member-id', {
        boards: 'open',
        organizations: 'all'
      });
    });
  });
});
