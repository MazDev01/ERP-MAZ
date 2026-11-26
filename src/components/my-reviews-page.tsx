"use client";

/*
 * งานที่รอฉันตรวจ (รอบที่ 130 · คำตอบเจ้าของ 25 พ.ย. 2569)
 *
 * สายงาน DM มีขั้น "ตรวจก่อนส่งลูกค้า" ที่ต้องให้หลายคนดู — ฝ่ายโครงการ BD และฝ่ายขาย
 * แต่ละคนอยู่คนละเมนู ฝ่ายขายไม่มีหน้างานของฝ่ายโครงการให้เปิด
 * จึงมีหน้านี้เป็นที่รวมของทุกบทบาท (อยู่ใน SHARED_PAGES) เห็นเฉพาะใบที่ตัวเองถูกตั้งเป็นผู้ตรวจ
 *
 * รายการมาจากฟังก์ชันของฐานข้อมูลพร้อมชื่อคน เพราะผู้ตรวจอยู่คนละฝ่าย
 * ถ้าให้หน้าจอประกอบชื่อเอง จะขึ้นเป็นรหัสพนักงานของคนที่เราไม่มีสิทธิ์เห็นทะเบียน
 *
 * ครบทุกคนกดผ่าน ฐานข้อมูลปิดงานให้เอง — คนแรกที่กดไม่ได้ปิดงานแทนคนอื่น
 */

import { useCallback, useEffect, useState } from "react";
import { projectHref } from "@/lib/pm-data";
import { reviewTask } from "@/lib/pm-store";
import { fetchMyReviews, type MyReviewRow } from "@/lib/supabase/pm";
import { hasBackend } from "@/lib/supabase/env";
import { thaiDate } from "@/lib/format";
import { ClockIcon, TasksIcon } from "./icons";

export function MyReviewsPage() {
  const [rows, setRows] = useState<MyReviewRow[] | null>(hasBackend ? null : []);
  const [busy, setBusy] = useState("");
  const [why, setWhy] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");

  const load = useCallback(() => {
    if (!hasBackend) return;
    void fetchMyReviews().then(setRows);
  }, []);

  useEffect(load, [load]);

  async function send(r: MyReviewRow, ok: boolean) {
    const key = r.task;
    if (!ok && !(why[key] ?? "").trim()) {
      setToast("บอกเหตุผลที่ขอแก้ก่อน");
      return;
    }
    setBusy(key);
    const res = await reviewTask(r.pj, r.name, ok, why[key] ?? "");
    setBusy("");
    setToast(
      !res.ok
        ? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง"
        : res.status === "done"
          ? "ตรวจผ่านครบทุกคนแล้ว งานนี้เสร็จ"
          : res.status === "revise"
            ? "ส่งกลับให้แก้แล้ว"
            : "บันทึกผลของคุณแล้ว รออีกคนตรวจ",
    );
    load();
  }

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1>งานที่รอฉันตรวจ</h1>
          <p>ใบงานที่ฝ่ายโครงการตั้งให้คุณเป็นผู้ตรวจ · ครบทุกคนกดผ่านงานจึงเสร็จ</p>
        </div>
      </div>

      {toast && <p className="rounded-[11px] bg-muted px-3.5 py-2.5 text-[12.5px] font-semibold">{toast}</p>}

      {rows === null ? (
        <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">กำลังอ่านรายการ…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-[14px] border border-border bg-white px-4 py-8 text-center text-[13px] text-muted-foreground">
          ไม่มีงานที่รอคุณตรวจ
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.task} className="rounded-[14px] border border-border bg-white px-4 py-3.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <TasksIcon className="size-[15px] text-primary" strokeWidth={2.1} />
                <b className="text-[14px]">{r.name}</b>
                <a className="lnk text-[12.5px]" href={projectHref(r.pj)}>
                  {r.project}
                </a>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                <ClockIcon className="size-[13px]" strokeWidth={2.1} />
                กำหนดส่ง {r.due ? thaiDate(r.due) : "—"}
                {r.sentBy ? ` · ส่งโดย ${r.sentBy}${r.sent ? ` ${r.sent}` : ""}` : ""}
                {r.doers.length ? ` · ผู้ทำ ${r.doers.join(", ")}` : ""}
              </p>
              {r.note && <p className="mt-1.5 text-[12.5px]">{r.note}</p>}
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                ผู้ตรวจ {r.reviewers.map((x) => `${x.name}${x.ok ? " ✓" : ""}`).join(" · ")}
              </p>
              <input
                value={why[r.task] ?? ""}
                onChange={(e) => setWhy((w) => ({ ...w, [r.task]: e.target.value }))}
                placeholder="เหตุผลที่ขอแก้ (กรอกเมื่อจะส่งกลับแก้)"
                aria-label={`เหตุผลที่ขอแก้ ${r.name}`}
                className="field-control mt-2.5 h-[38px] w-full text-[13px]"
              />
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={busy === r.task}
                  className="btn flex-1 justify-center !bg-destructive !text-white"
                  onClick={() => void send(r, false)}
                >
                  ขอแก้
                </button>
                <button
                  type="button"
                  disabled={busy === r.task}
                  className="btn solid flex-1 justify-center !bg-[var(--success)] !text-white"
                  onClick={() => void send(r, true)}
                >
                  ตรวจผ่าน
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
