import {
  ObligationsView,
  type ObligationsSearchParams,
} from "../_components/obligations-view";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Bills",
  description: "Due bills as obligation occurrences. Scheduling never moves cash.",
};

type Props = {
  searchParams: Promise<{
    notice?: string | string[];
    error?: string | string[];
    offset?: string | string[];
  }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BillsPage({ searchParams }: Props) {
  const params = await searchParams;
  const resolved: ObligationsSearchParams = {
    notice: single(params.notice),
    error: single(params.error),
    offset: single(params.offset),
  };
  return <ObligationsView kind="bill" searchParams={resolved} />;
}
