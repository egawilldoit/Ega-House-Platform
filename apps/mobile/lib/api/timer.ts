import { mobileApiFetch } from '@/lib/api/client';
import type {
  MobileTimerResponse,
  MobileTimerStartInput,
  MobileTimerStopInput,
  MobileTimerStopResponse,
} from '@ega/contracts';

export async function getMobileTimerState() {
  return mobileApiFetch<MobileTimerResponse>('/api/mobile/timer', {
    method: 'GET',
    auth: true,
  });
}

export async function startMobileTimer(input: MobileTimerStartInput) {
  return mobileApiFetch<MobileTimerResponse>('/api/mobile/timer/start', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(input),
  });
}

export async function stopMobileTimer(input: MobileTimerStopInput = {}) {
  return mobileApiFetch<MobileTimerStopResponse>('/api/mobile/timer/stop', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(input),
  });
}
