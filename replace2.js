/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
let C = fs.readFileSync('src/app/tasks/page.tsx', 'utf8');

let original = 'className=\"scroll-mt-24 rounded-[1.05rem] border border-[var(--border)] bg-[color:var(--instrument-raised)] px-4 py-4\"';
let newStr = 'className=\"scroll-mt-24 border-b border-[var(--border)] py-5 last:border-b-0\"';
C = C.split(original).join(newStr);

fs.writeFileSync('src/app/tasks/page.tsx', C);
