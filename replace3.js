/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');

// 1. Update CreateTaskForm
let createTask = fs.readFileSync('src/app/tasks/create-task-form.tsx', 'utf8');
createTask = createTask.replace(/className=\"input-instrument/g, 'className=\"flex h-10 w-full items-center justify-between rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]');
fs.writeFileSync('src/app/tasks/create-task-form.tsx', createTask);

// 2. Update InlineTaskUpdateForm
let inlineTask = fs.readFileSync('src/components/tasks/inline-task-update-form.tsx', 'utf8');
inlineTask = inlineTask.replace(/className=\"input-instrument/g, 'className=\"flex items-center justify-between rounded-md border border-[var(--border)] bg-white px-3 ring-offset-background focus:outline-none focus:ring-2 focus:ring-[var(--accent)]');
fs.writeFileSync('src/components/tasks/inline-task-update-form.tsx', inlineTask);

// 3. Update TaskFilterControls to be a single bar layout
let filters = fs.readFileSync('src/components/tasks/task-filter-controls.tsx', 'utf8');
filters = filters.replace(/className="grid gap-4 lg:grid-cols-2"/g, 'className="flex flex-wrap gap-x-8 gap-y-4"');
fs.writeFileSync('src/components/tasks/task-filter-controls.tsx', filters);
