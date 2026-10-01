"use client";

/*
 * หน้าแจ้งเตือนเต็มจอบนมือถือ — ต้นแบบ dose-erp-maz/mobile/notifications.html (1 ต.ค. 2569)
 *
 * แบ่งสองกลุ่ม: "ใหม่" (ยังไม่ได้อ่าน) และ "ก่อนหน้านี้" (อ่านแล้ว)
 * รายการใช้ชุดเดียวกับกระดิ่ง (useNotices) ตัวเลขและลิงก์จึงตรงกันเสมอ
 * แตะรายการ = อ่านแล้วแล้วไปหน้าของเรื่องนั้น · "อ่านทั้งหมด" = ล้างจุดแดงทุกรายการ
 */

import Link from "next/link";
import { markAllRead, markRead, useReadNotices } from "@/lib/notification-store";
import type { Notice } from "@/lib/notifications";
import { useNotices } from "./notification-menu";
import { ICONS } from "./app-shell";

/* สีของวงไอคอนตามระดับความเร่งด่วน (ต้นแบบใช้สามโทน) */
const TONE: Record<Notice["level"], string> = {
  late: "bg-[#FCE3E7] text-[#B0101F]",
  soon: "bg-[#FDEDD6] text-[#94500A]",
  info: "bg-[#E3EEFC] text-[#1A5DB5]",
};

const CARD =
  "rounded-[20px] border border-white/95 bg-white/80 shadow-[0_12px_30px_-22px_rgb(140_20_40/0.45)] backdrop-blur-[18px]";

/** ไอคอนของเรื่องนั้น — เดาจากหน้าปลายทาง ให้ตรงกับไอคอนในเมนู */
function iconOf(href: string) {
  const path = href.split("?")[0];
  if (path.startsWith("/acc/billing")) return ICONS.billing;
  if (path.startsWith("/acc/receipts")) return ICONS.receipt;
  if (path.startsWith("/leave") || path.startsWith("/approvals")) return ICONS.leave;
  if (path.startsWith("/ot")) return ICONS.ot;
  if (path.startsWith("/hr")) return ICONS.team;
  if (path.startsWith("/pm") || path.startsWith("/my-tasks")) return ICONS.tasks;
  if (path.startsWith("/quotations")) return ICONS.quotation;
  if (path.startsWith("/leads")) return ICONS.leads;
  if (path.startsWith("/presales")) return ICONS.presales;
  if (path.startsWith("/deals")) return ICONS.deals;
  return ICONS.home;
}

export function NotificationsPage() {
  const notices = useNotices();
  const read = useReadNotices();
  const fresh = notices.filter((n) => !read.includes(n.id));
  const old = notices.filter((n) => read.includes(n.id));

  return (
    <div className="-mx-4 -mt-[18px] min-h-full px-0 pb-24">
      {/* พื้นไล่สีชมพูด้านบน ชุดเดียวกับหน้าหลัก */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[320px]"
        style={{
          background:
            "radial-gradient(55% 55% at 90% 8%, #FCD3DA 0%, rgba(252,211,218,0) 70%), radial-gradient(60% 50% at 15% 25%, #FFFFFF 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg, #FBE1E6 0%, rgba(250,246,246,0) 85%)",
        }}
      />

      <div className="relative flex flex-col gap-3.5 pt-1">
        {/* แถบหัวของหน้าอยู่ที่เปลือกแอปแล้ว (ย้อนกลับ + ชื่อหน้า) ตรงนี้เหลือปุ่มอ่านทั้งหมด */}
        {fresh.length > 0 && (
          <div className="flex justify-end px-4">
            <button
              type="button"
              onClick={() => markAllRead(notices.map((n) => n.id))}
              className={`h-9 rounded-full px-3.5 text-[13px] font-semibold text-primary ${CARD}`}
            >
              อ่านทั้งหมด
            </button>
          </div>
        )}

        {notices.length === 0 ? (
          <p className={`mx-4 px-5 py-12 text-center text-[13px] text-muted-foreground ${CARD}`}>
            ไม่มีเรื่องค้าง — เคลียร์หมดแล้ว
          </p>
        ) : (
          <>
            <Group title="ใหม่" count={fresh.length} rows={fresh} unread />
            <Group title="ก่อนหน้านี้" rows={old} />
          </>
        )}
      </div>
    </div>
  );
}

function Group({
  title,
  count,
  rows,
  unread = false,
}: {
  title: string;
  count?: number;
  rows: Notice[];
  unread?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-2 px-5">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {count != null && count > 0 && (
          <span className="num rounded-[6px] bg-primary px-1.5 py-px text-[11px] font-bold text-white">
            {String(count).padStart(2, "0")}
          </span>
        )}
      </div>
      <ul className="flex list-none flex-col gap-2.5 px-4">
        {rows.map((n) => {
          const Icon = iconOf(n.href);
          return (
            <li key={n.id}>
              <Link
                href={n.href}
                onClick={() => markRead(n.id)}
                className={`relative flex gap-3 p-3.5 pr-8 text-foreground ${CARD} ${unread ? "" : "opacity-80"}`}
              >
                <span className={`grid size-[42px] flex-none place-items-center rounded-full ${TONE[n.level]}`}>
                  <Icon className="size-[19px]" strokeWidth={2.1} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <b className="text-[14.5px] font-bold">{n.title}</b>
                  <span className="text-[13px] leading-snug text-muted-foreground">{n.detail}</span>
                  <em className="text-[11.5px] text-muted-foreground not-italic">{n.group}</em>
                </span>
                {unread && (
                  <span
                    aria-label="ยังไม่ได้อ่าน"
                    className="absolute top-[18px] right-4 size-[9px] rounded-full bg-primary"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
