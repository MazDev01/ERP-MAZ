"use client";

/*
 * การ์ดรายการสำหรับมือถือของหน้าบัญชีและฝ่ายบุคคล (จอกว้างไม่ถึง 640px เท่านั้น)
 *
 * ตาราง cards-sm ที่คลี่เป็นการ์ดให้เองจะเรียงทุกคอลัมน์เป็นบรรทัดละช่อง
 * ตารางแปดคอลัมน์จึงกลายเป็นการ์ดสูงแปดบรรทัด คนละสิบกว่าคนก็ต้องปัดยาวมาก
 * การ์ดนี้เอา "ใคร + ยอดเงิน + สถานะ" ขึ้นบรรทัดบนสุด ตัวเลขรองวางเป็นกริดเล็ก
 * และปุ่มจัดการเป็นปุ่มใหญ่ท้ายการ์ด กดด้วยนิ้วได้ถนัด
 *
 * หน้าที่ใช้ต้องซ่อนตารางเดิมบนมือถือ (max-sm:hidden) แล้ววางรายการนี้ไว้ข้างกัน
 * บนจอกว้างรายการนี้ถูกซ่อน (sm:hidden) หน้าตาบน PC จึงเหมือนเดิมทุกอย่าง
 */

import type { ReactNode } from "react";

export function PhoneList({ children, empty }: { children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="space-y-2.5 p-3 sm:hidden">
      {empty ? (
        <div className="rounded-[22px] bg-white px-4 py-[26px] text-center text-[13.5px] text-[#A3979A] shadow-[0_1px_2px_rgb(120_20_35/0.05),0_12px_28px_-18px_rgb(120_20_35/0.3)]">
          {empty}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export type PhoneStat = { label: string; value: ReactNode; muted?: boolean; tone?: string };

export function PhoneCard({
  title,
  sub,
  amount,
  amountNote,
  badge,
  stats,
  statRows,
  actions,
  onOpen,
  openLabel,
  alert,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  amount?: ReactNode;
  amountNote?: ReactNode;
  badge?: ReactNode;
  stats?: PhoneStat[];
  /** แสดงตัวเลขเป็นแถว ชื่อซ้าย ค่าขวา แทนกล่องสี่เหลี่ยม (ต้นแบบหน้าตรวจเวลาทำงาน 1 ต.ค. 2569) */
  statRows?: boolean;
  actions?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
  /** การ์ดที่ต้องจัดการก่อน ขึ้นพื้นแดงอ่อน */
  alert?: boolean;
  children?: ReactNode;
}) {
  const open = onOpen
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": openLabel,
        onClick: onOpen,
        onKeyDown: (ev: React.KeyboardEvent) => {
          if (ev.target !== ev.currentTarget) return;
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onOpen();
          }
        },
      }
    : {};
  return (
    <div
      {...open}
      className={`rounded-[22px] p-3.5 shadow-[0_1px_2px_rgb(120_20_35/0.05),0_12px_28px_-18px_rgb(120_20_35/0.3)] ${
        alert ? "bg-[#FFF7F7]" : "bg-white"
      } ${onOpen ? "cursor-pointer active:bg-[#FBF5F4]" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] leading-snug font-bold break-words">{title}</div>
          {sub && <div className="mt-0.5 text-[12.5px] leading-snug text-[#6E6164]">{sub}</div>}
        </div>
        {(amount != null || amountNote) && (
          <div className="flex-none text-right">
            {amount != null && <div className="num text-[15px] font-bold whitespace-nowrap">{amount}</div>}
            {amountNote && <div className="text-[11px] text-[#A3979A]">{amountNote}</div>}
          </div>
        )}
      </div>
      {badge && <div className="mt-2 flex flex-wrap items-center gap-1.5">{badge}</div>}
      {stats && stats.length > 0 && statRows && (
        <dl className="mt-1.5">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between gap-3 border-b border-[#F2EAEC] py-2.5 last:border-0"
            >
              <dt className="text-[13px] text-[#6E6164]">{s.label}</dt>
              <dd className={`num text-[14.5px] font-semibold ${s.muted ? "text-muted-foreground" : ""} ${s.tone ?? ""}`}>
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {stats && stats.length > 0 && !statRows && (
        <dl
          className={`mt-2.5 grid gap-x-2 gap-y-2 rounded-[14px] bg-[#FBF7F7] px-3 py-2.5 ${
            stats.length === 3 || stats.length > 4 ? "grid-cols-3" : "grid-cols-2"
          }`}
        >
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="text-[11px] leading-tight font-semibold text-[#A3979A]">{s.label}</dt>
              <dd
                className={`num mt-0.5 text-[13.5px] font-semibold break-words ${
                  s.muted ? "text-muted-foreground" : ""
                } ${s.tone ?? ""}`}
              >
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      {actions && (
        /* ปุ่มในการ์ดไม่ส่งการกดต่อไปที่ตัวการ์ด กดแก้แล้วจะไม่เปิดกล่องรายละเอียดซ้อน */
        <div
          /* ปุ่มสูง 44 มุม 14 ตามต้นแบบมือถือ (billing.html) กดด้วยนิ้วถนัด */
          className="mt-3 flex flex-wrap gap-2.5 [&>*]:h-11! [&>*]:min-w-0 [&>*]:flex-1 [&>*]:justify-center [&>*]:rounded-[14px]!"
          onClick={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => ev.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
