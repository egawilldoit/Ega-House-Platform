import * as fs from 'node:fs';
import * as path from 'node:path';

describe('mobile Inbox processing surface', () => {
  const screenPath = path.join(__dirname, '../../../app/(app)/(tabs)/inbox.tsx');
  const screen = fs.readFileSync(screenPath, 'utf8');

  it('makes archived items and processing actions discoverable', () => {
    expect(screen).toMatch(/SegmentedControl/);
    expect(screen).toMatch(/view/);
    expect(screen).toMatch(/InboxEditSheet/);
    expect(screen).toMatch(/InboxConvertSheet/);
    expect(screen).toMatch(/useUpdateInboxMutation/);
    expect(screen).toMatch(/useConvertInboxMutation/);
    expect(screen).toMatch(/inbox-edit-/);
    expect(screen).toMatch(/inbox-convert-/);
  });

  it('offers a destination for the task created by conversion', () => {
    expect(screen).toMatch(/useRouter/);
    expect(screen).toMatch(/result\.task\.id/);
    expect(screen).toMatch(/tasks\/\[id\]/);
  });
});
