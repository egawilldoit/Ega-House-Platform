import { SegmentedControl } from '@/components/mobile/ui/SegmentedControl';

export type WorkMode = 'tasks' | 'projects';

const OPTIONS: Array<{ label: string; value: WorkMode }> = [
  { label: 'Tasks', value: 'tasks' },
  { label: 'Projects', value: 'projects' },
];

export type WorkModeSelectorProps = {
  value: WorkMode;
  onChange: (mode: WorkMode) => void;
  testID?: string;
};

export function WorkModeSelector({ value, onChange, testID }: WorkModeSelectorProps) {
  return <SegmentedControl value={value} onChange={onChange} options={OPTIONS} testID={testID ?? 'work-mode-selector'} />;
}
