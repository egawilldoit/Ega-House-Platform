"use server";

import { revalidatePath } from "next/cache";

import { sendWeeklyReviewPreviewEmail } from "@/lib/email/weekly-review-preview";
import { getResendClient, getResendEmailEnvConfig } from "@/lib/email/resend";
import { getWeekBounds } from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";

import {
  getReviewFormValuesFromFormData,
  toWeekReviewWriteFields,
  type ReviewFormValues,
} from "./review-form-state";
import { resolveMatchingWeeklyReview } from "./weekly-review-match";

export type SaveReviewFormState = {
  error: string | null;
  saved: boolean;
  saveMode: "created" | "updated" | null;
  values: ReviewFormValues;
};

export type SendReviewPreviewState = {
  error: string | null;
  sent: boolean;
  messageId: string | null;
};

function errorState(
  error: string,
  values: SaveReviewFormState["values"],
): SaveReviewFormState {
  return {
    error,
    saved: false,
    saveMode: null,
    values,
  };
}

function previewErrorState(error: string): SendReviewPreviewState {
  return {
    error,
    sent: false,
    messageId: null,
  };
}

export async function saveReviewAction(
  _previous: SaveReviewFormState,
  formData: FormData,
): Promise<SaveReviewFormState> {
  const values = getReviewFormValuesFromFormData(formData);
  const { weekOf, summary } = values;

  if (!weekOf) {
    return errorState("Week date is required.", values);
  }

  if (!summary) {
    return errorState("Summary is required.", values);
  }

  const bounds = getWeekBounds(weekOf);

  if (!bounds) {
    return errorState("Week date is invalid.", values);
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return errorState("You must be signed in to save a review.", values);
  }

  const ownerUserId = authData.user.id;
  const reviewFields = toWeekReviewWriteFields(values);
  const { data: existingReviews, error: existingReviewError } = await supabase
    .from("week_reviews")
    .select("id, owner_user_id, week_start, week_end, created_at, updated_at")
    .eq("owner_user_id", ownerUserId)
    .eq("week_start", bounds.weekStart)
    .eq("week_end", bounds.weekEnd)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (existingReviewError) {
    return errorState("Unable to save review right now.", values);
  }

  const existingReview = resolveMatchingWeeklyReview(existingReviews ?? [], {
    ownerUserId,
    weekStart: bounds.weekStart,
    weekEnd: bounds.weekEnd,
  });
  const saveMode = existingReview ? "updated" : "created";

  const { data: savedReview, error: saveError } = await supabase
    .from("week_reviews")
    .upsert(
      {
        owner_user_id: ownerUserId,
        week_start: bounds.weekStart,
        week_end: bounds.weekEnd,
        updated_at: new Date().toISOString(),
        ...reviewFields,
      },
      { onConflict: "owner_user_id,week_start" },
    )
    .select("id")
    .single();

  if (saveError) {
    return errorState("Unable to save review right now.", values);
  }

  revalidatePath("/review");
  if (savedReview.id) {
    revalidatePath(`/review/${savedReview.id}`);
  }

  return {
    error: null,
    saved: true,
    saveMode,
    values,
  };
}

export async function sendReviewPreviewAction(
  _previous: SendReviewPreviewState,
  formData: FormData,
): Promise<SendReviewPreviewState> {
  const reviewId = formData.get("reviewId");

  if (typeof reviewId !== "string" || !reviewId.trim()) {
    return previewErrorState("Save this weekly review before sending a preview.");
  }

  const envResult = getResendEmailEnvConfig();
  if (!envResult.ok) {
    return previewErrorState(
      `Email preview is not configured. Missing: ${envResult.missing.join(", ")}.`,
    );
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return previewErrorState("You must be signed in to send a review preview.");
  }

  const { data: review, error: reviewError } = await supabase
    .from("week_reviews")
    .select("id, week_start, week_end, summary, wins, blockers, next_steps")
    .eq("owner_user_id", authData.user.id)
    .eq("id", reviewId.trim())
    .maybeSingle();

  if (reviewError) {
    return previewErrorState("Unable to load weekly review for email preview.");
  }

  if (!review) {
    return previewErrorState("Save this weekly review before sending a preview.");
  }

  const resend = getResendClient(envResult.config.resendApiKey);
  const result = await sendWeeklyReviewPreviewEmail({
    review: {
      id: review.id,
      weekStart: review.week_start,
      weekEnd: review.week_end,
      summary: review.summary,
      wins: review.wins,
      blockers: review.blockers,
      nextSteps: review.next_steps,
    },
    appUrl: process.env.APP_URL ?? "https://www.egawilldoit.online",
    from: envResult.config.emailFrom,
    to: envResult.config.dailyAssistantEmail,
    send: (message) => resend.emails.send(message),
  });

  if (!result.ok) {
    return previewErrorState(result.error);
  }

  return {
    error: null,
    sent: true,
    messageId: result.id,
  };
}
