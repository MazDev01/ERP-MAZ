"use client";

/*
 * ยื่นใบลา / ใบโอทีแทนคนที่ยังไม่มีบัญชีเข้าระบบ
 *
 * คนที่ยังไม่มีบัญชี (เด็กฝึกงาน ช่างหน้างาน คนที่เพิ่งเข้าใหม่) ส่งใบเป็นกระดาษเข้าฝ่ายบุคคล
 * หน้านี้คือทางเดียวที่ใบพวกนั้นจะเข้าสายอนุมัติจริงและถูกนับในเงินเดือน
 *
 * ใบที่ยื่นจากหน้านี้ไม่ใช่ใบ "อนุมัติแล้ว" — ยังต้องผ่านผู้อนุมัติตามตำแหน่งของเจ้าของใบเหมือนทุกใบ
 * (ของที่เกิดขึ้นไปแล้วก่อนเริ่มใช้ระบบ ใช้ "ยกวันลาที่ใช้ไปแล้ว" ในแฟ้มพนักงานแทน)
 *
 * ฐานข้อมูลเป็นคนคุมว่ายื่นแทนใครได้ (can_file_for) — หน้าจอแค่ไม่เสนอชื่อคนที่มีบัญชีให้เลือก
 */

import { Time24Input, UI_TIME_CLS } from "./time24-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateField } from "./thai-date-picker";
import { Field, Select, Textarea } from "./ui";
import { thaiDate, todayIso } from "@/lib/format";
import { isWorkday } from "@/lib/holidays";
import { leaveTypes } from "@/lib/leave-data";
import { roleLabel } from "@/lib/role";
import { formatMinutesOfDay, minutesOfDay } from "@/lib/work-schedule";
import { fetchFiledByMe, fetchNoAccount, type FiledDoc } from "@/lib/supabase/file-for";
import { fileLeave } from "@/lib/supabase/leave";
import { fileOt } from "@/lib/supabase/ot";
import type { Person } from "@/lib/supabase/people";

/** จำนวนวันลา — นับเฉพาะวันทำงาน เสาร์อาทิตย์และวันหยุดบริษัทไม่ถูกหักสิทธิ์ */
function workdaysBetween(from: string, to: string) {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (const d = new Date(`${from}T00:00:00`); ; d.setDate(d.getDate() + 1)) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (iso > to) break;
    if (isWorkday(d, iso)) n += 1;
  }
  return n;
}

const SAY: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  no_account: "บัญชีนี้ยังไม่ผูกกับทะเบียนพนักงาน",
  no_route: "ตำแหน่งของคนนี้ยังไม่มีผู้อนุมัติในสายอนุมัติ — ให้ตั้งค่าสายอนุมัติก่อน",
  insert_failed: "บันทึกไม่สำเร็จ",
};

export function HrFileForPage() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [docs, setDocs] = useState<FiledDoc[]>([]);
  const [who, setWho] = useState("");
  const [kind, setKind] = useState<"leave" | "ot">("leave");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState("");
  const [done, setDone] = useState("");

  /* ใบลา */
  const [type, setType] = useState(leaveTypes()[0] ?? "ลากิจ");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [half, setHalf] = useState<"" | "morning" | "afternoon">("");
  /* ใบโอที */
  const [date, setDate] = useState("");
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("20:00");
  const [reason, setReason] = useState("");

  /*
   * หน้าเปิดใหม่มีการอ่านซ้อนกันหลายรอบ (React เรียก effect สองครั้งในโหมดพัฒนา
   * และรอบแรกอาจยิงก่อน session กู้คืนเสร็จ) — รอบที่ได้คำตอบ "ว่าง" อาจกลับมาทีหลัง
   * แล้วลบรายการที่อ่านได้แล้วทิ้ง เห็นเป็นตาราง "ยังไม่มีใบ" ทั้งที่มีใบอยู่
   * จึงนับรอบไว้ แล้วรับเฉพาะคำตอบของรอบล่าสุดเท่านั้น
   */
  const round = useRef(0);
  const reload = useCallback(() => {
    const n = ++round.current;
    void fetchNoAccount().then((v) => {
      if (n === round.current) setPeople(v);
    });
    void fetchFiledByMe().then((v) => {
      if (n === round.current) setDocs(v);
    });
  }, []);
  useEffect(reload, [reload]);

  const days = useMemo(() => {
    const n = workdaysBetween(from, to);
    return half && from && from === to ? 0.5 : n;
  }, [from, to, half]);
  const hours = useMemo(() => {
    const a = minutesOfDay(start);
    const b = minutesOfDay(end);
    return b > a ? Math.round(((b - a) / 60) * 100) / 100 : 0;
  }, [start, end]);

  const missing: string[] = [];
  if (!who) missing.push("ยังไม่ได้เลือกพนักงาน");
  if (kind === "leave") {
    if (!from || !to) missing.push("ยังไม่ได้เลือกวันที่ลา");
    else if (days <= 0) missing.push("ช่วงที่เลือกไม่มีวันทำงานให้ลา");
  } else {
    if (!date) missing.push("ยังไม่ได้เลือกวันที่ทำโอที");
    else if (hours <= 0) missing.push("เวลาเลิกต้องหลังเวลาเริ่ม");
  }
  if (!reason.trim()) missing.push("ยังไม่ได้กรอกเหตุผล");

  function submit() {
    if (missing.length || saving) return;
    setSaving(true);
    setFailed("");
    setDone("");
    const job =
      kind === "leave"
        ? fileLeave({
            type,
            from,
            to,
            days,
            half: half || undefined,
            reason: reason.trim(),
            employeeId: who,
          }).then((r) =>
            r.ok
              ? { ok: true as const, no: r.record.id }
              : { ok: false as const, reason: r.reason },
          )
        : fileOt({
            date,
            startMin: minutesOfDay(start),
            endMin: minutesOfDay(end),
            hours,
            reason: reason.trim(),
            employeeId: who,
          }).then((r) =>
            r.ok
              ? { ok: true as const, no: r.record.id }
              : { ok: false as const, reason: r.reason },
          );

    void job
      .then((r) => {
        if (!r.ok) {
          setFailed(SAY[r.reason] ?? `บันทึกไม่สำเร็จ — ${r.reason}`);
          return;
        }
        setDone(`ยื่นแล้ว เลขที่ ${r.no} — ส่งเข้าคิวผู้อนุมัติตามตำแหน่งของเจ้าของใบ`);
        setReason("");
        setFrom("");
        setTo("");
        setDate("");
        setHalf("");
        reload();
      })
      .finally(() => setSaving(false));
  }

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <h1 className="text-[19px] leading-tight font-bold">ยื่นใบแทนพนักงาน</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            สำหรับคนที่ยังไม่มีบัญชีเข้าระบบ — คนที่ล็อกอินได้เองต้องยื่นใบเอง
          </p>
        </div>
      </div>

      {people !== null && people.length === 0 && (
        <p className="rounded-[11px] border border-border bg-white px-4 py-3 text-[13px] text-muted-foreground">
          ตอนนี้พนักงานทุกคนมีบัญชีเข้าระบบแล้ว จึงยื่นแทนใครไม่ได้ — ทุกคนยื่นใบของตัวเองได้จากเครื่องตัวเอง
        </p>
      )}

      {people !== null && people.length > 0 && (
        <div className="space-y-4 rounded-[14px] border border-border bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ยื่นแทน" required>
              <Select
                value={who}
                onChange={(e) => setWho(e.target.value)}
                aria-label="เลือกพนักงานที่จะยื่นแทน"
              >
                <option value="">— เลือกพนักงาน —</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.empNo} · {p.name} ({roleLabel(p.role)})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="ชนิดใบ" required>
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as "leave" | "ot")}
                aria-label="ชนิดใบที่จะยื่น"
              >
                <option value="leave">ใบลา</option>
                <option value="ot">ใบโอที</option>
              </Select>
            </Field>
          </div>

          {kind === "leave" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="ประเภทการลา" required>
                <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="ประเภทการลา">
                  {leaveTypes().map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="ครึ่งวัน" hint="เลือกได้เมื่อลาวันเดียว">
                <Select
                  value={half}
                  onChange={(e) => setHalf(e.target.value as "" | "morning" | "afternoon")}
                  aria-label="ลาครึ่งวัน"
                  disabled={!from || from !== to}
                >
                  <option value="">เต็มวัน</option>
                  <option value="morning">ครึ่งวันเช้า</option>
                  <option value="afternoon">ครึ่งวันบ่าย</option>
                </Select>
              </Field>
              <Field label="ตั้งแต่วันที่" required>
                <DateField
                  value={from}
                  onChange={(v) => {
                    setFrom(v);
                    if (!to || to < v) setTo(v);
                  }}
                  label="ตั้งแต่วันที่"
                />
              </Field>
              <Field label="ถึงวันที่" required>
                <DateField value={to} onChange={setTo} label="ถึงวันที่" min={from || undefined} />
              </Field>
              <p className="num text-[13px] text-muted-foreground sm:col-span-2">
                รวม {days} วันทำงาน (ไม่นับเสาร์อาทิตย์และวันหยุดบริษัท)
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="วันที่ทำโอที" required>
                <DateField value={date} onChange={setDate} label="วันที่ทำโอที" max={todayIso()} />
              </Field>
              <Field label="เริ่ม" required>
                <Time24Input className={UI_TIME_CLS}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  aria-label="เวลาเริ่มทำโอที"
                />
              </Field>
              <Field label="ถึง" required>
                <Time24Input className={UI_TIME_CLS}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  aria-label="เวลาเลิกทำโอที"
                />
              </Field>
              <p className="num text-[13px] text-muted-foreground sm:col-span-3">
                รวม {hours} ชั่วโมง ({formatMinutesOfDay(minutesOfDay(start))}–
                {formatMinutesOfDay(minutesOfDay(end))} น.)
              </p>
            </div>
          )}

          <Field label="เหตุผล" required hint="เขียนตามที่เจ้าตัวแจ้งไว้ในใบกระดาษ">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="เหตุผล"
              placeholder={kind === "leave" ? "เช่น ติดต่อราชการ" : "เช่น ติดตั้งระบบหน้างานนอกเวลา"}
            />
          </Field>

          {missing.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              ยังกรอกไม่ครบ — {missing.join(" · ")}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-[13px] text-destructive">
              {failed}
            </p>
          )}
          {done && (
            <p role="status" className="text-[13px] font-medium text-[#1f7a3d]">
              {done}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={missing.length > 0 || saving}
            className="h-9 rounded-[10px] bg-primary px-4 text-sm font-medium text-white disabled:opacity-45"
          >
            {saving ? "กำลังยื่น…" : "ยื่นใบนี้"}
          </button>
        </div>
      )}

      <div className="rounded-[14px] border border-border bg-white p-4">
        <h2 className="text-[15px] font-bold">ใบที่ยื่นแทนไว้</h2>
        {docs.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted-foreground">ยังไม่มีใบที่ยื่นแทนคนอื่น</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {docs.map((d) => (
              <li
                key={d.no}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-border px-3 py-2 text-[13px]"
              >
                <span className="num font-medium">{d.no}</span>
                <span>{d.who}</span>
                <span className="text-muted-foreground">
                  {d.kind === "leave" ? "ใบลา" : "ใบโอที"} · {d.what}
                </span>
                <span className="font-medium">{d.status}</span>
                <span className="num text-muted-foreground">{thaiDate(d.at.slice(0, 10))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
