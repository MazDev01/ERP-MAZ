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

export function HrSteps({ month, group }: { month?: string; group?: "month" | "day" }) {
  const here = usePathname();
  /* ข้ามขั้นแล้วต้องอยู่กลุ่มเดิม ไม่ใช่กลับไปหน้าเลือกกลุ่มใหม่ทุกครั้ง (เจ้าของแจ้ง 2 ต.ค. 2569) */
  const qs = [month ? `m=${month}` : "", group ? `g=${group}` : ""].filter(Boolean).join("&");
  return (
    <nav
      aria-label="ขั้นตอนของรอบเงินเดือน"
      /* มือถือ: เป็นเม็ดยาเลื่อนแนวนอน ขั้นที่เปิดอยู่พื้นเข้ม (ต้นแบบชุด 1 ต.ค. 2569) */
      className="flex w-fit max-w-full overflow-x-auto rounded-[12px] border border-border bg-muted/50 max-md:-mx-4 max-md:w-auto max-md:gap-2 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-4 max-md:[scrollbar-width:none]"
    >
      {STEPS.map((s) => {
        const on = here === s.href;
        return (
          <Link
            key={s.href}
            href={qs ? `${s.href}?${qs}` : s.href}
            aria-current={on ? "page" : undefined}
            className={`flex h-11 flex-none items-center px-4 text-[14px] font-semibold whitespace-nowrap transition-colors sm:px-6 max-md:h-9 max-md:rounded-full max-md:border-0! max-md:px-3.5 max-md:text-[13px] ${
              on
                ? "bg-card text-primary max-md:bg-[#2A1F22]! max-md:text-white!"
                : "text-muted-foreground hover:text-primary max-md:bg-[#EDE8EA]! max-md:text-[#6E6164]!"
            } ${s.href === "/hr/timesheet" ? "" : "border-l border-border"}`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** กลุ่มที่ส่งมาทาง ?g= จากขั้นก่อนหน้า — เปิดหน้ามาอยู่กลุ่มเดิมเลย */
export function useUrlGroup(): "month" | "day" | "" {
  const g = useSearchParams().get("g") ?? "";
  return g === "month" || g === "day" ? g : "";
}

/**
 * เดือนที่ส่งมาทาง ?m= จากขั้นก่อนหน้า (ต้นแบบ urlMonth) — คืนค่าเฉพาะเดือนที่มีรอบจริง ไม่งั้นคืน ""
 * หน้าที่เรียกต้องมี Suspense คร่อมที่ page.tsx เพราะ useSearchParams
 */
export function useUrlMonth(months: string[]) {
  const m = useSearchParams().get("m") ?? "";
  return /^\d{4}-\d{2}$/.test(m) && months.includes(m) ? m : "";
}
