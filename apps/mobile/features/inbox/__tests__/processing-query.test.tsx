import * as ReactQuery from '@tanstack/react-query';

import * as inboxApi from '@/lib/api/inbox';
import {
  useConvertInboxMutation,
  useInboxListQuery,
  useUpdateInboxMutation,
} from '../query';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('@/lib/api/inbox', () => ({
  convertInboxItem: jest.fn(),
  listInboxItems: jest.fn(),
  updateInboxItem: jest.fn(),
}));

type QueryOptions = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

type MutationOptions = {
  mutationFn: (input: unknown) => Promise<unknown>;
  onSuccess?: (data: unknown) => void;
};

const mock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;

let queryCall: QueryOptions | null = null;
let mutationCalls: MutationOptions[] = [];

function installReactQueryCapture() {
  queryCall = null;
  mutationCalls = [];
  (ReactQuery.useQuery as unknown as jest.Mock).mockImplementation((options: QueryOptions) => {
    queryCall = options;
    return { data: undefined };
  });
  (ReactQuery.useMutation as unknown as jest.Mock).mockImplementation((options: MutationOptions) => {
    mutationCalls.push(options);
    return { isPending: false, mutate: jest.fn() };
  });
}

function installQueryClient() {
  const invalidateQueries = jest.fn().mockResolvedValue(undefined);
  mock(ReactQuery.useQueryClient).mockReturnValue({ invalidateQueries } as never);
  return invalidateQueries;
}

describe('Inbox processing query boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installReactQueryCapture();
    installQueryClient();
  });

  it('requests the selected Inbox view through the canonical API adapter', async () => {
    const response = { ok: true, items: [], projects: [], filters: { view: 'all' }, total: 0 };
    mock(inboxApi.listInboxItems).mockResolvedValue(response as never);

    useInboxListQuery({ view: 'all' });

    expect(queryCall?.queryKey).toEqual(['inbox', 'list', { view: 'all' }]);
    await expect(queryCall?.queryFn()).resolves.toBe(response);
    expect(inboxApi.listInboxItems).toHaveBeenCalledWith({ view: 'all' });
  });

  it('updates an item and invalidates every Inbox view after success', async () => {
    mock(inboxApi.updateInboxItem).mockResolvedValue({ ok: true } as never);
    const invalidateQueries = installQueryClient();

    useUpdateInboxMutation();

    const input = { title: 'Edited idea', status: 'reviewing' };
    await mutationCalls[0].mutationFn({ id: 'inbox-1', input });
    expect(inboxApi.updateInboxItem).toHaveBeenCalledWith('inbox-1', input);

    mutationCalls[0].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'] });
  });

  it('converts an item and invalidates Inbox, Tasks, and Today projections', async () => {
    mock(inboxApi.convertInboxItem).mockResolvedValue({ ok: true } as never);
    const invalidateQueries = installQueryClient();

    useConvertInboxMutation();

    const input = { projectId: 'project-1' };
    await mutationCalls[0].mutationFn({ id: 'inbox-1', input });
    expect(inboxApi.convertInboxItem).toHaveBeenCalledWith('inbox-1', input);

    mutationCalls[0].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['inbox'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['today'] });
  });
});
