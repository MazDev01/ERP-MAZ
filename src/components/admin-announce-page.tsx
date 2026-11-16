"use client";

import { useState } from "react";
import { AdminHead, Card, Input2, inputCls } from "./admin-ui";
import { DateField } from "./thai-date-picker";
import { thaiDate, thaiStamp, todayIso } from "@/lib/format";
import { ROLES, type Role } from "@/lib/role";
import { useAnnounces, refreshAnnounces } from "@/lib/announce-store";
import { ANNOUNCE_REASON, postAnnounce, removeAnnounce } from "@/lib/supabase/announce";
import { logChange } from "@/lib/admin-log";
import type { Level } from "@/lib/notifications";

/*
 * ประกาศถึงพนักงาน (ฝ่ายบุคคล)
 *
 * เรื่องที่ระบบคิดเองไม่ได้ ต้องมีคนบอก — ปิดบริษัทวันศุกร์ · ย้ายออฟฟิศ · อบรมพรุ่งนี้
 * ประกาศไปโผล่ที่กระดิ่งแจ้งเตือนของคนที่ตรงบทบาท (ฐานข้อมูลเป็นคนคัดผู้รับ ไม่ใช่หน้าจอ)
 *
 * ไม่มีปุ่มแก้ประกาศที่โพสต์ไปแล้ว — คนอ่านไปแล้วจำของเดิม แก้ทีหลังทำให้เข้าใจไม่ตรงกัน
 * ผิดก็ลบแล้วประกาศใหม่ จะได้เห็นชัดว่าเป็นคนละฉบับ
 */

const LEVELS: { key: Level; label: string; why: string }[] = [
  { key: "info", label: "ทั่วไป", why: "เรื่องแจ้งให้ทราบ" },
  { key: "soon", label: "ควรรู้", why: "มีผลกับงานเร็ว ๆ นี้" },
  { key: "late", label: "ด่วน", why: "ต้องรู้วันนี้" },
];

export function AdminAnnouncePage() {
  const list = useAnnounces();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [level, setLevel] = useState<Level>("info");
  const [roles, setRoles] = useState<Role[]>([]);
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (r: Role) =>
    setRoles((v) => (v.includes(r) ? v.filter((x) => x !== r) : [...v, r]));

  async function post() {
    if (!title.trim()) {
      setMsg({ ok: false, text: "ต้องมีหัวข้อประกาศ" });
      return;
    }
    if (until && until < todayIso()) {
      setMsg({ ok: false, text: "วันหมดอายุต้องไม่ย้อนหลัง" });
      return;
    }
    setBusy(true);
    const res = await postAnnounce({ title, detail, level, roles, until });
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: ANNOUNCE_REASON[res.reason] ?? res.reason });
      return;
    }
    logChange(
      "บัญชีผู้ใช้",
      `ประกาศ "${title.trim()}" ถึง ${roles.length ? roles.join(" · ") : "ทุกคน"}${until ? ` · ถึง ${thaiDate(until)}` : ""}`,
    );
    refreshAnnounces();
    setTitle("");
    setDetail("");
    setRoles([]);
    setUntil("");
    setLevel("info");
    setMsg({ ok: true, text: "ประกาศแล้ว — ขึ้นที่กระดิ่งแจ้งเตือนของคนที่ตรงบทบาททันที" });
  }

  async function drop(id: string, label: string) {
    setBusy(true);
    const res = await removeAnnounce(id);
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: ANNOUNCE_REASON[res.reason] ?? res.reason });
      return;
    }
    logChange("บัญชีผู้ใช้", `เอาประกาศ "${label}" ออก`);
    refreshAnnounces();
    setMsg({ ok: true, text: "เอาประกาศออกแล้ว" });
  }

  return (
    <div className="space-y-4">
      <AdminHead
        title="ประกาศถึงพนักงาน"
        desc="เรื่องที่ระบบคิดเองไม่ได้ — ประกาศแล้วขึ้นที่กระดิ่งแจ้งเตือนของคนที่ตรงบทบาท"
      />

      <Card title="ประกาศใหม่">
        <div className="grid gap-4">
          <Input2 label="หัวข้อ">
            <input
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น ปิดบริษัทวันศุกร์ที่ 20 พ.ย."
              className={inputCls}
            />
          </Input2>

          <Input2 label="รายละเอียด (ไม่บังคับ)">
            <textarea
              value={detail}
              maxLength={500}
              rows={3}
              onChange={(e) => setDetail(e.target.value)}
              className={`${inputCls} h-auto py-2`}
            />
          </Input2>

          <div>
            <span className="block text-xs text-muted-foreground">ระดับ</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLevel(l.key)}
                  aria-pressed={level === l.key}
                  title={l.why}
                  className={`h-9 rounded-full border px-3.5 text-[13px] transition-colors ${
                    level === l.key ? "border-primary bg-primary text-white" : "border-border bg-card hover:border-primary"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs text-muted-foreground">
              ถึงใคร — ไม่เลือกเลยคือทุกคน
            </span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => toggle(r.key)}
                  aria-pressed={roles.includes(r.key)}
                  className={`h-9 rounded-full border px-3.5 text-[13px] transition-colors ${
                    roles.includes(r.key)
                      ? "border-primary bg-primary text-white"
                      : "border-border bg-card hover:border-primary"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="max-w-[260px]">
            <Input2 label="แสดงถึงวันที่ (ไม่ใส่ = จนกว่าจะเอาออกเอง)">
              <DateField value={until} onChange={(d) => setUntil(d ?? "")} label="วันสุดท้ายที่แสดงประกาศ" />
            </Input2>
          </div>

          {msg && (
            <p
              role="status"
              className="rounded-[11px] px-3.5 py-2.5 text-[13px] leading-relaxed"
              style={
                msg.ok
                  ? { background: "var(--success-soft)", color: "var(--success)" }
                  : { background: "var(--destructive-soft)", color: "var(--destructive)" }
              }
            >
              {msg.text}
            </p>
          )}

          <div>
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={() => void post()}
              className="btn solid btn-solid disabled:opacity-45"
            >
              {busy ? "กำลังประกาศ…" : "ประกาศ"}
            </button>
          </div>
        </div>
      </Card>

      <Card title={`ประกาศที่แสดงอยู่ (${list.length})`}>
        {list.length === 0 ? (
          <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">
            ยังไม่มีประกาศ
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
            {list.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 px-3.5 py-3">
                <span className="min-w-0 flex-1">
                  <b className="block text-[14px] font-semibold">{a.title}</b>
                  {a.detail && <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{a.detail}</span>}
                  <span className="mt-1 block text-[12px] text-muted-foreground">
                    ถึง {a.roles.length ? a.roles.map((r) => ROLES.find((x) => x.key === r)?.label ?? r).join(" · ") : "ทุกคน"}
                    {" · "}
                    ประกาศเมื่อ {thaiStamp(a.from)}
                    {a.until ? ` · ถึง ${thaiDate(a.until.slice(0, 10))}` : " · ไม่มีวันหมดอายุ"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void drop(a.id, a.title)}
                  className="btn glass-thin btn-mini text-destructive disabled:opacity-45"
                >
                  เอาออก
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
