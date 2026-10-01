import { Suspense } from "react";
import { NotificationsPage } from "@/components/notifications-page";

export const metadata = { title: "แจ้งเตือน — ERP MAZ" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NotificationsPage />
    </Suspense>
  );
}
