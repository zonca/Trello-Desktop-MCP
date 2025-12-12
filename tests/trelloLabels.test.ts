import { TrelloClient } from '../src/trello/client';
import { jest } from '@jest/globals';

describe('TrelloClient Label Operations', () => {
  let fetchSpy: jest.SpyInstance;

  beforeAll(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((url: RequestInfo | URL, init?: RequestInit) => {
      const urlString = url.toString();
      const urlObj = new URL(urlString);
      const urlPath = urlObj.pathname;
      const method = init?.method || 'GET';

      switch (`${method} ${urlPath}`) {
        case 'POST /1/labels':
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              id: 'newLabelId',
              name: urlObj.searchParams.get('name'),
              color: urlObj.searchParams.get('color'),
              idBoard: urlObj.searchParams.get('idBoard'),
              uses: 0
            }),
            headers: new Headers()
          } as Response);

        case 'PUT /1/labels/labelToUpdate':
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              id: 'labelToUpdate',
              name: urlObj.searchParams.get('name') || 'Old Name',
              color: urlObj.searchParams.get('color') || 'oldcolor',
              idBoard: 'testBoardId',
              uses: 5
            }),
            headers: new Headers()
          } as Response);

        case 'POST /1/cards/testCardId/idLabels':
          const labelId = urlObj.searchParams.get('value');
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([
              'existingLabelId',
              labelId
            ]),
            headers: new Headers()
          } as Response);

        case 'DELETE /1/cards/testCardId/idLabels/labelToRemove':
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({}),
            headers: new Headers()
          } as Response);

        default:
          return Promise.resolve({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ message: 'Not Found' }),
            headers: new Headers()
          } as Response);
      }
    });
  });

  afterAll(() => {
    fetchSpy.mockRestore();
  });

  const client = new TrelloClient({
    apiKey: 'dummy_key',
    token: 'dummy_token',
  });

  test('should create a label via the mocked API', async () => {
    const boardId = 'testBoardId';
    const name = 'New Label';
    const color = 'red';
    const response = await client.createLabel(boardId, name, color);
    expect(response.data.id).toBe('newLabelId');
    expect(response.data.name).toBe(name);
    expect(response.data.color).toBe(color);
  });

  test('should update a label via the mocked API', async () => {
    const labelId = 'labelToUpdate';
    const updates = { name: 'Updated Label', color: 'blue' };
    const response = await client.updateLabel(labelId, updates);
    expect(response.data.id).toBe(labelId);
    expect(response.data.name).toBe(updates.name);
    expect(response.data.color).toBe(updates.color);
  });

  test('should add a label to a card via the mocked API', async () => {
    const cardId = 'testCardId';
    const labelId = 'newLabelId';
    const response = await client.addLabelToCard(cardId, labelId);
    expect(response.data).toContain(labelId);
    expect(response.data).toContain('existingLabelId');
  });

  test('should remove a label from a card via the mocked API', async () => {
    const cardId = 'testCardId';
    const labelId = 'labelToRemove';
    const response = await client.removeLabelFromCard(cardId, labelId);
    expect(response.data).toEqual({});
  });
});
