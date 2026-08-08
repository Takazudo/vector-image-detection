export type ButtonVariant = "default" | "primary" | "quiet" | "confirm" | "reject";

const buttonBase =
  "min-h-control appearance-none whitespace-nowrap rounded-md border border-line-strong bg-surface px-md py-xs text-ui font-medium text-ink transition-colors motion-reduce:transition-none hover-safe:not-disabled:bg-sunken active:not-disabled:translate-y-px disabled:cursor-not-allowed disabled:opacity-45";

const buttonVariants: Record<ButtonVariant, string> = {
  default: "",
  primary:
    "border-accent bg-accent text-accent-ink hover-safe:not-disabled:border-accent-hover hover-safe:not-disabled:bg-accent-hover active:not-disabled:bg-accent-hover",
  quiet: "min-h-icon px-sm py-3xs text-sm",
  confirm: "text-positive",
  reject: "text-danger",
};

export function buttonClass(variant: ButtonVariant = "default"): string {
  return `${buttonBase} ${buttonVariants[variant]}`;
}

export function tabClass(active: boolean): string {
  return [
    "min-h-control appearance-none cursor-pointer rounded-t-md border-0 border-b-2 border-transparent bg-transparent px-sm py-xs text-ui text-muted transition-colors motion-reduce:transition-none hover-safe:bg-sunken hover-safe:text-ink active:bg-sunken",
    active ? "border-b-accent bg-transparent font-semibold text-ink hover-safe:bg-transparent" : "",
  ].join(" ");
}

export function pillClass(active: boolean): string {
  return [
    "min-h-control appearance-none cursor-pointer rounded-pill border border-line bg-surface px-sm py-3xs text-sm text-muted transition-colors motion-reduce:transition-none hover-safe:border-line-strong hover-safe:text-ink active:bg-sunken",
    active ? "border-subtle bg-sunken font-semibold text-ink" : "",
  ].join(" ");
}

export function photoGridClass(compact = false): string {
  return `grid ${compact ? "grid-auto-thumb gap-xs" : "grid-auto-photo gap-md"}`;
}

export const viewClass = "flex flex-col gap-lg";
export const viewHeaderClass = "flex flex-col gap-3xs";
export const viewTitleClass = "m-0 text-title font-semibold tracking-tight";
export const viewLedeClass = "m-0 max-w-prose text-ui text-muted";
export const viewNoteClass = "m-0 text-sm text-muted";
export const viewErrorClass = "m-0 text-sm text-danger";
export const toolbarClass =
  "flex flex-wrap items-end gap-md rounded-md border border-line bg-surface p-md";
export const fieldClass = "flex min-w-0 flex-col gap-3xs";
export const growFieldClass = `${fieldClass} basis-field grow`;
export const fieldLabelClass = "text-xs font-semibold uppercase tracking-wide text-muted";
export const fieldInputClass =
  "min-h-control w-full rounded-md border border-line-strong bg-page px-sm py-xs text-body text-ink focus-visible:border-accent";
export const fieldRangeClass = "min-h-control w-full accent-accent";
export const fieldHintClass = "m-0 max-w-prose text-xs text-subtle";
