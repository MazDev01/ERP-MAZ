"use client";

/*
 * แถบขั้นตอนของรอบเงินเดือน (ตามต้นแบบ dose-erp-maz/hr-payroll.html — .steps)
 *
 * สี่หน้านี้เดินต่อกันเป็นสาย ตรวจเวลา → คำนวณเงินเดือน → ออกสลิป → ประวัติรอบ
 * เมนูข้างจึงมีรายการเดียวคือ "รอบเงินเดือน" แล้วข้ามขั้นด้วยแถบนี้
 * เดือนที่เลือกส่งต่อกันทาง ?m= จะได้ไม่ต้องเลือกเดือนใหม่ทุกครั้งที่ข้ามขั้น
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const STEPS = [
  { href: "/hr/timesheet", label: "ตรวจเวลาทำงาน" },
  { href: "/hr/payroll", label: "คำนวณเงินเดือน" },
  { href: "/hr/payslip", label: "ออกสลิปเงินเดือน" },
  { href: "/hr/cycles", label: "ประวัติรอบ" },
];

export function HrSteps({ month }: { month?: string }) {
  const here = usePathname();
  return (
    <nav
      aria-label="ขั้นตอนของรอบเงินเดือน"
      /* มือถือ: สี่ขั้นแบ่งเต็มแถวเท่า ๆ กัน มีเลขขั้นกำกับ ชื่อขั้นตัดบรรทัดได้ ไม่ต้องปัดข้างหาขั้นสุดท้าย */
      className="flex w-fit max-w-full overflow-x-auto rounded-[12px] border border-border bg-muted/50 max-sm:grid max-sm:w-full max-sm:grid-cols-4"
    >
      {STEPS.map((s, i) => {
        const on = here === s.href;
        return (
          <Link
            key={s.href}
            href={month ? `${s.href}?m=${month}` : s.href}
            aria-current={on ? "page" : undefined}
            className={`flex h-11 flex-none items-center px-4 text-[14px] font-semibold whitespace-nowrap transition-colors sm:px-6 max-sm:h-auto max-sm:min-h-[56px] max-sm:min-w-0 max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:px-1 max-sm:py-1.5 max-sm:text-center max-sm:text-[11.5px] max-sm:leading-tight max-sm:whitespace-normal ${
              on ? "bg-card text-primary" : "text-muted-foreground hover:text-primary"
            } ${s.href === "/hr/timesheet" ? "" : "border-l border-border"}`}
          >
            <span
              aria-hidden
              className={`num grid size-5 place-items-center rounded-full text-[10.5px] font-bold sm:hidden ${
                on ? "bg-primary text-white" : "bg-border/70 text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * เดือนที่ส่งมาทาง ?m= จากขั้นก่อนหน้า (ต้นแบบ urlMonth) — คืนค่าเฉพาะเดือนที่มีรอบจริง ไม่งั้นคืน ""
 * หน้าที่เรียกต้องมี Suspense คร่อมที่ page.tsx เพราะ useSearchParams
 */
export function useUrlMonth(months: string[]) {
  const m = useSearchParams().get("m") ?? "";
  return /^\d{4}-\d{2}$/.test(m) && months.includes(m) ? m : "";
}
