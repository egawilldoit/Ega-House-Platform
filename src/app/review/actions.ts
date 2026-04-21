"use server";

import { revalidatePath } from "next/cache";

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
