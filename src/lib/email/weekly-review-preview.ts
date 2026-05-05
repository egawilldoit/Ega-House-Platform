export const WEEKLY_REVIEW_EMAIL_SUBJECT = "Your EGA Weekly Review is ready";

export type WeeklyReviewEmailRecord = {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  nextSteps: string | null;
};

export type WeeklyReviewEmail = {
  subject: typeof WEEKLY_REVIEW_EMAIL_SUBJECT;
  html: string;
  reviewUrl: string;
};

type WeeklyReviewEmailKind = "preview" | "official";

type WeeklyReviewPreviewSendInput = {
  review: WeeklyReviewEmailRecord;
  appUrl: string;
  from: string;
  to: string;
  send: (message: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }) => Promise<{ data?: { id?: string } | null; error?: unknown | null }>;
};

export type WeeklyReviewPreviewSendResult =
  | { ok: true; id: string | null; reviewUrl: string }
  | { ok: false; error: string };

const EMPTY_TEXT = "No saved content yet.";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeAppUrl(appUrl: string) {
  return (appUrl || "https://www.egawilldoit.online").replace(/\/+$/, "");
}

function textAfterHeading(value: string | null, headings: string[]) {
  const lines = value?.replace(/\r\n/g, "\n").split("\n") ?? [];
  const normalizedHeadings = headings.map((heading) => heading.toLowerCase());
  const startIndex = lines.findIndex((line) =>
    normalizedHeadings.includes(line.trim().toLowerCase()),
  );

  if (startIndex === -1) {
    return value?.trim() ?? "";
  }

  const nextHeadingIndex = lines.findIndex(
    (line, index) =>
      index > startIndex &&
      /^[A-Z][A-Za-z -]+$/.test(line.trim()) &&
      line.trim().length <= 48,
  );

  return lines
    .slice(startIndex + 1, nextHeadingIndex === -1 ? undefined : nextHeadingIndex)
    .join("\n")
    .trim();
}

function bodyWithoutLeadingHeading(value: string | null, heading: string) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return "";
  }

  const lines = normalized.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim().toLowerCase() === heading.toLowerCase()) {
    return lines.slice(1).join("\n").trim();
  }

  return normalized;
}

function renderMultiline(value: string) {
  const normalized = value.trim() || EMPTY_TEXT;
  const blocks = normalized.split(/\n{2,}/);

  return blocks
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const isList = lines.length > 0 && lines.every((line) => line.startsWith("- "));

      if (isList) {
        return `<ul style="margin:0;padding-left:20px;">${lines
          .map(
            (line) =>
              `<li style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;margin:0 0 6px 0;color:#374433;">${escapeHtml(line.slice(2))}</li>`,
          )
          .join("")}</ul>`;
      }

      return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;margin:0 0 10px 0;color:#374433;">${escapeHtml(
        lines.join(" "),
      )}</p>`;
    })
    .join("");
}

function renderSection(title: string, content: string) {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #dfe8db;border-radius:12px;margin:0 0 12px 0;">
      <tr>
        <td style="padding:18px;">
          <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;margin:0 0 12px 0;color:#182016;">${escapeHtml(title)}</h2>
          ${renderMultiline(content)}
        </td>
      </tr>
    </table>
  `;
}

export function buildWeeklyReviewEmail(
  review: WeeklyReviewEmailRecord,
  appUrl = process.env.APP_URL ?? "https://www.egawilldoit.online",
  kind: WeeklyReviewEmailKind = "preview",
): WeeklyReviewEmail {
  const baseUrl = normalizeAppUrl(appUrl);
  const reviewUrl = `${baseUrl}/review/${encodeURIComponent(review.id)}?weekOf=${encodeURIComponent(
    review.weekStart,
  )}`;
  const sections = [
    renderSection(
      "Weekly Summary",
      textAfterHeading(review.summary, ["Weekly Summary"]) ||
        bodyWithoutLeadingHeading(review.summary, "Weekly Summary"),
    ),
    renderSection("Wins", bodyWithoutLeadingHeading(review.wins, "Wins")),
    renderSection("Time Breakdown", textAfterHeading(review.summary, ["Time Breakdown"])),
    renderSection("Blockers", bodyWithoutLeadingHeading(review.blockers, "Main Blockers")),
    renderSection(
      "Carried-Over Tasks",
      textAfterHeading(review.nextSteps, ["Carried-Over Tasks"]),
    ),
    renderSection(
      "Suggested Next Week Plan",
      textAfterHeading(review.nextSteps, ["Suggested Next Week Plan", "Suggested Next Steps"]) ||
        bodyWithoutLeadingHeading(review.nextSteps, "Suggested Next Steps"),
    ),
  ].join("");

  return {
    subject: WEEKLY_REVIEW_EMAIL_SUBJECT,
    reviewUrl,
    html: `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${WEEKLY_REVIEW_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7f2;color:#182016;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">Weekly review for ${escapeHtml(
      review.weekStart,
    )} to ${escapeHtml(review.weekEnd)}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7f2;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:660px;background:#fbfdf9;border:1px solid #dfe8db;border-radius:16px;">
            <tr>
              <td style="padding:28px 24px 10px 24px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#15803d;font-weight:700;">EGA House</div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;color:#047857;font-weight:700;text-transform:uppercase;letter-spacing:0;padding-top:14px;">Weekly review</div>
                <h1 style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;margin:8px 0 10px 0;color:#182016;font-weight:700;">Your weekly review is ready</h1>
                <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;margin:0;color:#607060;">${escapeHtml(
                  review.weekStart,
                )} to ${escapeHtml(review.weekEnd)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 24px 6px 24px;">
                ${sections}
              </td>
            </tr>
            <tr>
              <td align="left" style="padding:8px 24px 30px 24px;">
                <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;border-radius:10px;padding:15px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:700;">Open full review</a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #dfe8db;padding:16px 24px 22px 24px;">
                <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;margin:0;color:#607060;">${escapeHtml(
                  kind === "official"
                    ? "Official weekly review sent by EGA House."
                    : "Preview sent by EGA House. This does not mark weekly review as sent.",
                )}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export async function sendWeeklyReviewPreviewEmail({
  review,
  appUrl,
  from,
  to,
  send,
}: WeeklyReviewPreviewSendInput): Promise<WeeklyReviewPreviewSendResult> {
  const email = buildWeeklyReviewEmail(review, appUrl);

  try {
    const result = await send({
      from,
      to,
      subject: email.subject,
      html: email.html,
    });

    if (result.error) {
      return { ok: false, error: "Resend failed to send weekly review preview." };
    }

    return { ok: true, id: result.data?.id ?? null, reviewUrl: email.reviewUrl };
  } catch {
    return { ok: false, error: "Resend failed to send weekly review preview." };
  }
}
