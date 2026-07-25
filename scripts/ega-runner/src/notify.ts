/**
 * Slack Notifier — posts one Slack thread per delivery.
 *
 * OWNERSHIP: Slack is notification-only.
 * The thread contains: status, PR link, Vercel preview, and key findings.
 */

import { execSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SlackMessage {
  ok: boolean;
  ts: string;
  channel: string;
}

export interface SlackNotificationConfig {
  /** Slack channel/webhook URL */
  channel: string;
  /** Run identifier */
  runId: string;
  /** Issue identifier */
  issueIdentifier: string;
  /** Issue URL */
  issueUrl: string;
  /** PR URL */
  prUrl: string | null;
  /** Vercel preview URL */
  vercelPreviewUrl: string | null;
  /** Pipeline status */
  status: "started" | "completed" | "failed" | "cancelled";
  /** Summary message */
  summary: string;
  /** Number of findings */
  findingCount?: number;
  /** Thread timestamp to reply to (for follow-ups) */
  threadTs?: string;
}

// ── Post a Slack message ───────────────────────────────────────────────────

/**
 * Post a pipeline notification to Slack.
 * Uses the Hermes Slack Gateway webhook if configured, otherwise falls back
 * to a simple curl to a webhook URL.
 *
 * V1: Falls back gracefully if no Slack integration is configured.
 */
export async function postSlackNotification(
  config: SlackNotificationConfig,
): Promise<string | null> {
  const webhookUrl = process.env.EGA_RUNNER_SLACK_WEBHOOK_URL;
  const slackToken = process.env.SLACK_BOT_TOKEN;

  const emoji = config.status === "completed" ? "✅" :
    config.status === "failed" ? "❌" :
    config.status === "cancelled" ? "🚫" : "🔄";

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} EGA Delivery Pipeline — ${config.issueIdentifier}`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Status:* ${config.status}` },
        { type: "mrkdwn", text: `*Run:* \`${config.runId.substring(0, 8)}…\`` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: config.summary },
    },
  ];

  // Add links
  const links: string[] = [];
  if (config.issueUrl) links.push(`<${config.issueUrl}|Linear Ticket>`);
  if (config.prUrl) links.push(`<${config.prUrl}|Pull Request>`);
  if (config.vercelPreviewUrl) links.push(`<${config.vercelPreviewUrl}|Vercel Preview>`);

  if (links.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: links.join(" · ") },
    });
  }

  // Try webhook URL first
  if (webhookUrl) {
    try {
      const result = execSync(
        `curl -s -X POST -H 'Content-type: application/json' ` +
          `--data '${JSON.stringify({ text: `${emoji} EGA Delivery: ${config.issueIdentifier} — ${config.status}`, blocks, thread_ts: config.threadTs || undefined }).replace(/'/g, "'\\''")}' ` +
          `'${webhookUrl}'`,
        { stdio: "pipe", timeout: 30_000, encoding: "utf8" },
      ).toString().trim();

      console.log(`[slack] Notification posted (webhook): ${result.substring(0, 100)}`);
      return config.threadTs ?? result;
    } catch (err) {
      console.error(`[slack] Webhook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Try Slack API token
  if (slackToken) {
    try {
      const payload: Record<string, unknown> = {
        channel: config.channel,
        text: `${emoji} EGA Delivery: ${config.issueIdentifier} — ${config.status}`,
        blocks,
      };
      if (config.threadTs) {
        payload.thread_ts = config.threadTs;
      }

      const result = execSync(
        `curl -s -X POST -H 'Authorization: Bearer ${slackToken}' ` +
          `-H 'Content-type: application/json' ` +
          `--data '${JSON.stringify(payload).replace(/'/g, "'\\''")}' ` +
          `'https://slack.com/api/chat.postMessage'`,
        { stdio: "pipe", timeout: 30_000, encoding: "utf8" },
      ).toString().trim();

      const data = JSON.parse(result);
      if (data.ok) {
        console.log(`[slack] Notification posted to #${data.channel} ts=${data.ts}`);
        return data.ts as string;
      } else {
        console.error(`[slack] API error: ${data.error}`);
      }
    } catch (err) {
      console.error(`[slack] API call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[slack] No Slack integration configured — notification skipped (set EGA_RUNNER_SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN)`);
  return null;
}
