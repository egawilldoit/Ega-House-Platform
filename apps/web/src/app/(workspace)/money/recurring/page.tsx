import {
  ObligationsView,
  type ObligationsFilter,
  type ObligationsSearchParams,
} from "../_components/obligations-view";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Recurring",
  description:
    "Bills and subscriptions as obligation occurrences. Scheduling never moves cash.",
};

type Props = {
  searchParams: Promise<{
    type?: string | string[];
    notice?: string | string[];
    error?: string | string[];
    offset?: string | string[];
  }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function filterOf(raw: string | undefined): ObligationsFilter {
  const value = raw?.trim();
  if (value === "bill" || value === "subscription") {
    return value;
  }
  return "all";
}

export default async function RecurringPage({ searchParams }: Props) {
  const params = await searchParams;
  const resolved: ObligationsSearchParams = {
    notice: single(params.notice),
    error: single(params.error),
    offset: single(params.offset),
  };
  return (
    <ObligationsView filter={filterOf(single(params.type))} searchParams={resolved} />
  );
}
