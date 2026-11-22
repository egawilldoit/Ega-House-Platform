/** Shared display formatting for Money surfaces. Values stay integer centimes. */
export function formatMad(minor: number): string {
  return new Intl.NumberFormat("fr-MA", {
    style: "currency",
    currency: "MAD",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function movementKindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}
