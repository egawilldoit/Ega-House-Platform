export { ProjectCard } from '@/features/projects/components/ProjectCard';
import { statusTone } from '@/components/mobile/theme';

export function formatProjectToken(value: string) {
  return value.replaceAll('_', ' ');
}

export function projectStatusTone(status: string) {
  return statusTone(status as never);
}
