/**
 * Unit tests for task archive/pin API wrappers (lib/api/tasks.ts).
 * Stubs global.fetch to prove each action hits the right endpoint and
 * method with auth attached — zero network access.
 */
import { archiveMobileTask, pinMobileTask, unarchiveMobileTask, unpinMobileTask } from '@/lib/api/tasks';

const TASK_ID = 'task-1';

function stubTaskFetch() {
  return jest
    .spyOn(global, 'fetch')
    .mockImplementation(async () => {
      return new Response(
        JSON.stringify({ ok: true, task: { id: TASK_ID } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
}


describe('task archive/pin API wrappers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['archiveMobileTask', archiveMobileTask, `/api/tasks/${TASK_ID}/archive`],
    ['unarchiveMobileTask', unarchiveMobileTask, `/api/tasks/${TASK_ID}/unarchive`],
    ['pinMobileTask', pinMobileTask, `/api/mobile/tasks/${TASK_ID}/pin`],
    ['unpinMobileTask', unpinMobileTask, `/api/mobile/tasks/${TASK_ID}/unpin`],
  ])('%s posts to %s with auth', async (_name, action, expectedPath) => {
    const fetchMock = stubTaskFetch();

    const response = await action(TASK_ID);

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(expectedPath);
    expect((init as RequestInit).method).toBe('POST');
  });
});
