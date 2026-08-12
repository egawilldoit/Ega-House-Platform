import React from 'react';

const subscribe = () => () => {};

export function useClientOnlyValue<S, C>(server: S, client: C): S | C {
  return React.useSyncExternalStore<S | C>(
    subscribe,
    () => client,
    () => server,
  );
}
