import type { ReactNode } from "react";

export function StatusBanner({
  tone,
  children,
}: {
  tone: "info" | "warning" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "border-line bg-sunken text-ink",
    warning: "border-warning-line bg-warning-soft text-warning-ink",
    error: "border-danger-line bg-danger-soft text-danger-ink",
    success: "border-positive-line bg-positive-soft text-positive-ink",
  };
  return (
    <div
      className={`rounded-lg border px-md py-sm text-sm ${tones[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
