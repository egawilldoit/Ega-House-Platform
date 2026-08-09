import { sendWeeklyReviewsCron } from "../_lib/send-weekly-reviews";

export async function GET(request: Request) {
  return sendWeeklyReviewsCron(request);
}

export async function POST(request: Request) {
  return sendWeeklyReviewsCron(request);
}
