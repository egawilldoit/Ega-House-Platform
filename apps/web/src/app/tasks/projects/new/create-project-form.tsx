"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  type CreateProjectFormState,
  createProjectAction,
} from "./actions";

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const FIELD_LABEL_CLASS =
  "text-[length:var(--text-body)] font-medium text-[color:var(--ega-text)]";

export function CreateProjectForm() {
  const initialState: CreateProjectFormState = {
    error: null,
    values: {
      name: "",
      slug: "",
      description: "",
    },
  };
  const [state, formAction, isPending] = useActionState(
    createProjectAction,
    initialState,
  );
  const [slugEdited, setSlugEdited] = useState(Boolean(state.values.slug));

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className={FIELD_LABEL_CLASS}>
          Name
        </label>
        <Input
          id="name"
          name="name"
          required
          autoComplete="off"
          placeholder="Acme Website Relaunch"
          defaultValue={state.values.name}
          className="h-8 text-[length:var(--text-meta-lg)]"
          onChange={(event) => {
            if (slugEdited) {
              return;
            }
            const form = event.currentTarget.form;
            if (!form) {
              return;
            }
            const slugInput = form.elements.namedItem("slug");
            if (!(slugInput instanceof HTMLInputElement)) {
              return;
            }
            slugInput.value = normalizeSlug(event.currentTarget.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="slug" className={FIELD_LABEL_CLASS}>
          Slug
        </label>
        <Input
          id="slug"
          name="slug"
          required
          autoComplete="off"
          inputMode="text"
          pattern="[a-z0-9-]+"
          title="Lowercase letters, numbers, and hyphens only."
          placeholder="acme-website-relaunch"
          defaultValue={state.values.slug}
          className="h-8 text-[length:var(--text-meta-lg)]"
          onChange={(event) => {
            const nextValue = normalizeSlug(event.currentTarget.value);
            setSlugEdited(nextValue.length > 0);
            event.currentTarget.value = nextValue;
          }}
        />
        <p className="text-[length:var(--text-meta)] text-ega-text-secondary">
          Lowercase letters, numbers, and hyphens only.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="description" className={FIELD_LABEL_CLASS}>
          Description (optional)
        </label>
        <Textarea
          id="description"
          name="description"
          placeholder="What this project is for and what done looks like."
          defaultValue={state.values.description}
          className="text-[length:var(--text-meta-lg)]"
        />
      </div>

      {state.error ? (
        <div role="alert" className="feedback-block feedback-block-error">
          {state.error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating project..." : "Create project"}
        </Button>
        <Link
          href="/tasks/projects"
          className="btn-instrument btn-instrument-muted inline-flex h-8 items-center justify-center px-3 text-sm"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
