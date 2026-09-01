export function formatGp(
  value: string | number | bigint | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return "0 GP";
  }

  try {
    const numericValue =
      typeof value === "bigint"
        ? value
        : BigInt(String(value).split(".")[0]);

    return `${new Intl.NumberFormat("en-US").format(numericValue)} GP`;
  } catch {
    return "0 GP";
  }
}

export function getSlotCapacity(
  accountMode: string,
): number {
  return accountMode === "F2P" ? 3 : 8;
}

export function formatStatus(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map(
      (word) =>
        word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}
