"use server";

import { revalidatePath } from "next/cache";

import { getWeekBounds } from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";

import {
  getReviewFormValuesFromFormData,
  toWeekReviewWriteFields,
  type ReviewFormValues,
} from "./review-form-state";

export type SaveReviewFormState = {
  error: string | null;
  saved: boolean;
  values: ReviewFormValues;
};

function errorState(
  error: string,
  values: SaveReviewFormState["values"],
): SaveReviewFormState {
  return {
    error,
    saved: false,
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
  const reviewFields = toWeekReviewWriteFields(values);
  const { data: existingReviews, error: existingReviewError } = await supabase
    .from("week_reviews")
    .select("id")
    .eq("week_start", bounds.weekStart)
    .eq("week_end", bounds.weekEnd)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (existingReviewError) {
    return errorState("Unable to save review right now.", values);
  }

  const existingReview = existingReviews?.[0] ?? null;
  let savedReviewId: string | null = null;

  if (existingReview) {
    const { data: updatedReview, error } = await supabase
      .from("week_reviews")
      .update({
        ...reviewFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingReview.id)
      .select("id")
      .single();

    if (error) {
      return errorState("Unable to save review right now.", values);
    }

    savedReviewId = updatedReview.id;
  } else {
    const { data: createdReview, error } = await supabase
      .from("week_reviews")
      .insert({
        week_start: bounds.weekStart,
        week_end: bounds.weekEnd,
        ...reviewFields,
      })
      .select("id")
      .single();

    if (error) {
      return errorState("Unable to save review right now.", values);
    }

    savedReviewId = createdReview.id;
  }

  revalidatePath("/review");
  if (savedReviewId) {
    revalidatePath(`/review/${savedReviewId}`);
  }

  return {
    error: null,
    saved: true,
    values,
  };
}
