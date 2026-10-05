import { Suspense } from "react";
import { AccQuotationsPage } from "@/components/acc-quotations-page";

export const metadata = { title: "ใบเสนอราคา (บัญชี) — ERP MAZ" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccQuotationsPage />
    </Suspense>
  );
}
