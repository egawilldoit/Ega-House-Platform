/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
let C = fs.readFileSync('src/app/dashboard/_components/DashboardOptimizedView.tsx', 'utf8');

// 2. Remove DashboardMetric function definition
C = C.replace(/function DashboardMetric\([\s\S]*?\}\s*\)[\s\S]*?return \([\s\S]*?<\/div>\n  \);\n}\n/g, '');

// 3. Update 'ega-dashboard-hero-copy' (Live Workspace State)
let copyOriginal = `<div className="ega-dashboard-hero-copy">\n          <p className="glass-label text-[color:var(--signal-live)]\">Live Workspace State</p>\n          <h2 className="ega-dashboard-hero-title">\n            {greeting}, <span>operator.</span>\n          </h2>\n          <p className="ega-dashboard-hero-subtitle">\n            {getHeroSummary(tasks.length, completionRate)}\n          </p>\n        </div>`;
let copyNew = `<div className="ega-dashboard-hero-copy relative overflow-hidden">\n          <p className="glass-label text-[color:var(--signal-live)]">Live Workspace State</p>\n          <div className="flex items-center gap-6 mt-4">\n            <div className="relative w-16 h-16 flex-shrink-0">\n               <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">\n                  <path className="text-[var(--border)]" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />\n                  <path className="text-[var(--signal-live)]" strokeWidth="3" strokeDasharray={\`\${completionRate || 0}, 100\`} stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />\n               </svg>\n               <div className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-gray-700">{completionRate || 0}%</div>\n            </div>\n            <div>\n              <h2 className="ega-dashboard-hero-title">\n                {greeting}, <span>operator.</span>\n              </h2>\n              <p className="ega-dashboard-hero-subtitle mt-2">\n                {getHeroSummary(tasks.length, completionRate)}\n              </p>\n            </div>\n          </div>\n        </div>`;

if(C.includes('<div className="ega-dashboard-hero-copy">')) {
  let idx = C.indexOf('<div className="ega-dashboard-hero-copy">');
  let endIdx = C.indexOf('</div>', idx) + 6;
  C = C.substring(0, idx) + copyNew + C.substring(endIdx);
}

// Ensure the rail uses CSS grid
if(C.includes('<div className="ega-dashboard-hero-rail">')) {
  C = C.replace('<div className="ega-dashboard-hero-rail">', '<div className="grid grid-cols-2 gap-3">');
}

// 4. Replace DashboardMetric calls
let metric1 = /<DashboardMetric\s*label="Tasks In Focus"[\s\S]*?\/>/g;
C = C.replace(metric1, `<StatCard
            label="Tasks In Focus"
            value={String(tasks.length)}
            subtitle={completedCount > 0 ? \`\${completedCount} completed recently\` : "Backlog surfaced when today is quiet"}
            variant="green"
            icon={ListTodo}
            className="border-t-4 border-t-[#177b52]"
            trend={<ArrowUpRight className="w-3 h-3 text-[#177b52] inline-block mr-1" />}
          />`);

let metric2 = /<DashboardMetric\s*label="Urgent"[\s\S]*?\/>/g;
C = C.replace(metric2, `<StatCard
            label="Urgent"
            value={String(urgentCount)}
            subtitle={urgentCount > 0 ? "Immediate attention required" : "No urgent queue"}
            variant={urgentCount > 0 ? "default" : "muted"}
            icon={AlertCircle}
            className={urgentCount > 0 ? "border-t-4 border-t-[var(--signal-warn)]" : ""}
            trend={urgentCount > 0 ? <AlertTriangle className="w-3 h-3 text-[var(--signal-warn)] inline-block mr-1" /> : undefined}
          />`);

let metric3 = /<DashboardMetric\s*label="Tracked Today"[\s\S]*?\/>/g;
C = C.replace(metric3, `<StatCard
            label="Tracked Today"
            value={summary?.trackedTodayLabel ?? "--"}
            subtitle={summary ? summary.trackedTotalLabel : "Timer history unavailable"}
            icon={ClockIcon}
            className="border-t-4 border-t-[var(--signal-info)]"
          />`);

let metric4 = /<DashboardMetric\s*label="Projects"[\s\S]*?\/>/g;
C = C.replace(metric4, `<StatCard
            label="Projects"
            value={\`\${activeProjectCount}/\${totalProjectCount}\`}
            subtitle="Active vs total projects"
            icon={LayoutGrid}
            className="border-t-4 border-t-[var(--foreground)]"
          />`);

let metric5 = /<DashboardMetric\s*label="Goals Visible"[\s\S]*?\/>/g;
C = C.replace(metric5, `<StatCard
                label="Goals Visible"
                value={String(goalItems.length)}
                subtitle={goalItems.length > 0 ? "Existing goals pulled in from workspace" : "No goals yet"}
                icon={Target}
              />`);

let metric6 = /<DashboardMetric\s*label="Latest Check"[\s\S]*?\/>/g;
C = C.replace(metric6, `<StatCard
                label="Latest Check"
                value={formatTimerDateTime(health.checkedAt)}
                subtitle="OpenClaw health probe timestamp"
                icon={ClockIcon}
              />`);

// 5. Command Center dark card error banner
C = C.replace(/<div className="mt-4 rounded-\[0\.9rem\] border border-\[rgba\(230,81,0,0\.28\)\] bg-\[rgba\(230,81,0,0\.08\)\] px-3 py-2 text-sm text-\[color:var\(--signal-warn\)\]">\s*\{health\.statusText\}\s*<\/div>/, `<div className="mt-4 flex w-fit items-center gap-2 rounded-full border border-[rgba(230,81,0,0.28)] bg-[rgba(230,81,0,0.08)] px-3 py-1.5 text-xs font-semibold tracking-wide text-[color:var(--signal-warn)] shadow-sm">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {health.statusText}
                </div>`);

// 6. Review Pulse pills
let pillRegex = /<Badge tone="info">\s*\} - \{\s*<\/Badge>\s*<Badge tone="muted">\s*Updated \{\s*<\/Badge>/;
C = C.replace(/<Badge tone="info">\s*\{formatIsoDate\(latestReviewItem.weekStart\)\} - \{formatIsoDate\(latestReviewItem\.weekEnd\)\}\s*<\/Badge>/, `<Badge tone="info" className="rounded-full border-[#90caf9] bg-[#e3f2fd] px-3 text-[#1565c0] shadow-sm">
                    {formatIsoDate(latestReviewItem.weekStart)} - {formatIsoDate(latestReviewItem.weekEnd)}
                  </Badge>`);

C = C.replace(/<Badge tone="muted">\s*Updated \{formatTimerDateTime\(latestReviewItem\.updatedAt\)\}\s*<\/Badge>/, `<Badge tone="muted" className="rounded-full px-3 shadow-sm">
                    Updated {formatTimerDateTime(latestReviewItem.updatedAt)}
                  </Badge>`);

fs.writeFileSync('src/app/dashboard/_components/DashboardOptimizedView.tsx', C);
