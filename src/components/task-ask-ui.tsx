"use client";

/*
 * งานที่ทีมเสนอเอง (ยกมาจาก ERP_Test · เจ้าของอนุมัติ 20 ต.ค. 2569) — หน้าจอทั้งสองฝั่ง
 *   ทีมงาน  — ปุ่ม "เสนองาน" ในหน้างานที่ได้รับ และการ์ดบอกผลของใบที่เสนอไป
 *   ฝ่ายโครงการ — ส่วน "งานที่ทีมเสนอ" ในหน้างานเข้าใหม่ กดอนุมัติแล้วเกิดใบงานจริง
 *
 * เสนอได้เฉพาะงานของตัวเอง และทุกใบต้องผ่านฝ่ายโครงการก่อนเสมอ (กติกาของเจ้าของ)
 * ใบที่ตัดสินแล้วแก้ไม่ได้ ต้องเสนอใบใหม่ — ฐานข้อมูลกันไว้อีกชั้น
 */

import { useEffect, useState } from "react";
import { thaiDate } from "@/lib/format";
import { projName, type Project } from "@/lib/pm-data";
import { refreshPmNow, usePm } from "@/lib/pm-store";
import {
  ASK_FROM_LABEL,
  fetchTaskAsks,
  sbAskAdd,
  sbAskNo,
  sbAskOk,
  type AskFrom,
  type TaskAsk,
} from "@/lib/supabase/task-asks";
import { Sheet } from "./lead-dialogs";
import { ThaiDatePicker } from "./thai-date-picker";

const SAY: Record<string, string> = {
  not_allowed: "เฉพาะฝ่ายโครงการที่ตัดสินใบเสนอได้",
  not_open: "ใบนี้ถูกตัดสินไปแล้ว",
  no_project: "เลือกโปรเจคที่งานนี้จะไปอยู่",
  project_closed: "โปรเจคนี้ปิดงานแล้ว รับงานใหม่ไม่ได้",
  need_why: "บอกเหตุผลที่ไม่อนุมัติ",
  no_account: "บัญชีนี้ยังไม่ผูกกับทะเบียนพนักงาน แจ้งฝ่ายบุคคลก่อน",
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
};
const say = (k: string) => SAY[k] ?? "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";

/** อ่านใบเสนอทั้งหมดที่คนนี้เห็น พร้อมตัวสั่งอ่านใหม่ */
export function useTaskAsks() {
  const [rows, setRows] = useState<TaskAsk[]>([]);
  const reload = () => void fetchTaskAsks().then(setRows);
  useEffect(reload, []);
  return { rows, reload };
}

const fromText = (a: TaskAsk) => (a.fromName.trim() ? `${ASK_FROM_LABEL[a.from]} · ${a.fromName}` : ASK_FROM_LABEL[a.from]);

/* ── ฝั่งทีมงาน ───────────────────────────────────────────────── */

/** กล่องเสนองาน — ผู้เสนอคือผู้รับงานเสมอ */
export function ProposeSheet({
  projects,
  onClose,
  onSent,
}: {
  /** โปรเจคที่คนนี้มีงานอยู่ — เลือกได้ หรือเว้นว่างให้ฝ่ายโครงการจัดให้ */
  projects: Project[];
  onClose: () => void;
  onSent: (no: string) => void;
}) {
  const [name, setName] = useState("");
  const [pj, setPj] = useState(projects[0]?.pj ?? "");
  const [from, setFrom] = useState<AskFrom>("client");
  const [fromName, setFromName] = useState("");
  const [brief, setBrief] = useState("");
  const [due, setDue] = useState("");
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (!name.trim()) {
      setErr("ตั้งชื่องานก่อน");
      return;
    }
    setBusy(true);
    const res = await sbAskAdd({ pj, name, from, fromName, brief, due });
    setBusy(false);
    if (!res.ok) {
      setErr(say(res.reason));
      return;
    }
    onSent(res.no ?? "");
  }

  return (
    <Sheet
      title="เสนองานให้ฝ่ายโครงการ"
      narrow
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" disabled={busy} onClick={() => void send()}>
            ส่งให้ฝ่ายโครงการ
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
            ชื่องาน<em className="ml-0.5 text-primary not-italic">*</em>
          </span>
          <input
            value={name}
            aria-label="ชื่องาน"
            className="field-control"
            placeholder="เช่น ทำแบนเนอร์หน้าแรกเพิ่ม 2 ชิ้น"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">งานนี้อยู่ในโปรเจคไหน</span>
          <select value={pj} aria-label="โปรเจค" className="field-control" onChange={(e) => setPj(e.target.value)}>
            <option value="">ยังไม่แน่ใจ ให้ฝ่ายโครงการจัดให้</option>
            {projects.map((p) => (
              <option key={p.pj} value={p.pj}>
                {projName(p)}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">ใครขอมา</span>
          <div className="seg glass-thin" role="group" aria-label="ใครขอมา">
            {(["client", "staff"] as AskFrom[]).map((k) => (
              <button
                key={k}
                type="button"
                className={from === k ? "on" : ""}
                aria-pressed={from === k}
                onClick={() => setFrom(k)}
              >
                {ASK_FROM_LABEL[k]}
              </button>
            ))}
          </div>
          <input
            value={fromName}
            aria-label="ชื่อคนที่ขอมา"
            className="field-control mt-2"
            placeholder={from === "client" ? "ชื่อลูกค้าที่ขอมา" : "ชื่อคนในบริษัทที่ขอมา"}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">รายละเอียดงาน</span>
          <textarea
            value={brief}
            rows={3}
            aria-label="รายละเอียดงาน"
            className="field-control"
            placeholder="สิ่งที่ต้องทำ ขนาดงาน และสิ่งที่ได้รับมาแล้ว"
            onChange={(e) => setBrief(e.target.value)}
          />
        </label>

        <div>
          <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">กำหนดส่งที่อยากได้</span>
          <ThaiDatePicker
            value={due}
            open={pick}
            label="กำหนดส่งที่อยากได้"
            onToggle={() => setPick((v) => !v)}
            onPick={(iso) => {
              setPick(false);
              if (iso) setDue(iso);
            }}
          />
          <p className="mt-1 text-[11.5px] text-muted-foreground">ฝ่ายโครงการปรับกำหนดส่งได้ตอนอนุมัติ</p>
        </div>
        {err && <p className="text-[12.5px] font-semibold text-destructive">{err}</p>}
      </div>
    </Sheet>
  );
}

/** การ์ดบอกผลของใบที่เสนอไป — ขึ้นในหน้างานที่ได้รับของผู้เสนอ */
export function MyAskList({ rows }: { rows: TaskAsk[] }) {
  const live = rows.filter((a) => a.status !== "ok");
  if (live.length === 0) return null;
  return (
    <section className="glass rounded-[16px] px-4 py-4 sm:px-5">
      <h2 className="text-[14.5px] font-bold">งานที่เสนอไว้</h2>
      <ul className="mt-2 space-y-2">
        {live.map((a) => (
          <li key={a.no} className="rounded-[12px] border border-border px-3.5 py-2.5">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
              <span className="num">{a.no}</span>
              <span>{a.name}</span>
              {a.status === "waiting" ? (
                <span className="tag t-job">
                  <i />
                  รอฝ่ายโครงการอนุมัติ
                </span>
              ) : (
                <span className="tag t-late">
                  <i />
                  ไม่อนุมัติ
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {fromText(a)}
              {a.due ? ` · อยากได้ ${thaiDate(a.due)}` : ""}
            </p>
            {a.status === "no" && a.why && (
              <p className="mt-0.5 text-[12px] font-semibold text-destructive">เหตุผล: {a.why}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── ฝั่งฝ่ายโครงการ ─────────────────────────────────────────── */

/** งานที่ทีมเสนอ รออนุมัติ — วางในหน้างานเข้าใหม่ของฝ่ายโครงการ */
export function PmAskSection() {
  const pm = usePm();
  const { rows, reload } = useTaskAsks();
  const [msg, setMsg] = useState("");
  const waiting = rows.filter((a) => a.status === "waiting");
  /* ไม่มีใบค้างและไม่มีข้อความอะไรต้องบอก ก็ไม่ต้องกินที่บนหน้า
     แต่ถ้าเพิ่งตัดสินใบสุดท้ายไป ต้องคาข้อความผลไว้ให้อ่านก่อน (เจอตอนทดสอบรอบที่ 146) */
  if (waiting.length === 0 && !msg) return null;

  return (
    <section className="glass rounded-[15px] px-5 py-[18px] max-sm:px-4 max-sm:py-4">
      <h2 className="text-[15px] font-bold">
        งานที่ทีมเสนอ <span className="num">{waiting.length}</span>
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        งานที่ลูกค้าหรือคนในบริษัทสั่งกับคนทำโดยตรง — อนุมัติแล้วจะกลายเป็นใบงานในโปรเจคที่เลือก
      </p>
      {msg && <p className="mt-2 text-[12.5px] font-semibold text-primary">{msg}</p>}
      <ul className="mt-3 space-y-2">
        {waiting.map((a) => (
          <AskRow
            key={a.no}
            ask={a}
            projects={pm.projects.filter((p) => p.status === "running")}
            onDone={(m) => {
              setMsg(m);
              reload();
              refreshPmNow();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function AskRow({
  ask,
  projects,
  onDone,
}: {
  ask: TaskAsk;
  projects: Project[];
  onDone: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"" | "ok" | "no">("");
  const [pj, setPj] = useState(ask.pj || projects[0]?.pj || "");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    const res = mode === "ok" ? await sbAskOk(ask.no, pj) : await sbAskNo(ask.no, why);
    setBusy(false);
    if (!res.ok) {
      setErr(say(res.reason));
      return;
    }
    setMode("");
    onDone(mode === "ok" ? `อนุมัติ ${ask.no} แล้ว งานเข้าโปรเจค ${pj}` : `ไม่อนุมัติ ${ask.no} แล้ว`);
  }

  return (
    <li className="rounded-[12px] border border-border px-3.5 py-2.5">
      <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
        <span className="num">{ask.no}</span>
        <span>{ask.name}</span>
        <span className="tag t-info">
          <i />
          {fromText(ask)}
        </span>
      </p>
      {ask.brief && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{ask.brief}</p>}
      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
        เสนอโดย {ask.by}
        {ask.pj ? ` · เสนอให้อยู่ใน ${ask.pj}` : " · ยังไม่ระบุโปรเจค"}
        {ask.due ? ` · อยากได้ ${thaiDate(ask.due)}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="btn solid btn-solid btn-mini" onClick={() => { setErr(""); setMode("ok"); }}>
          อนุมัติ
        </button>
        <button type="button" className="btn glass-thin btn-mini" onClick={() => { setErr(""); setMode("no"); }}>
          ไม่อนุมัติ
        </button>
      </div>

      {mode && (
        <Sheet
          title={mode === "ok" ? `อนุมัติ ${ask.no}` : `ไม่อนุมัติ ${ask.no}`}
          narrow
          onClose={() => setMode("")}
          footer={
            <>
              <button type="button" className="btn glass-thin" onClick={() => setMode("")}>
                ยกเลิก
              </button>
              <button type="button" className="btn solid btn-solid" disabled={busy} onClick={() => void run()}>
                {mode === "ok" ? "อนุมัติและสร้างใบงาน" : "ไม่อนุมัติ"}
              </button>
            </>
          }
        >
          {mode === "ok" ? (
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
                งานนี้ไปอยู่โปรเจคไหน<em className="ml-0.5 text-primary not-italic">*</em>
              </span>
              <select value={pj} aria-label="โปรเจคปลายทาง" className="field-control" onChange={(e) => setPj(e.target.value)}>
                <option value="">— เลือกโปรเจค —</option>
                {projects.map((p) => (
                  <option key={p.pj} value={p.pj}>
                    {projName(p)}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11.5px] text-muted-foreground">
                ใบงานจะต่อท้ายเฟสสุดท้ายของโปรเจคนั้น และมอบให้ {ask.by} เป็นผู้รับงาน
              </span>
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
                เหตุผล<em className="ml-0.5 text-primary not-italic">*</em>
              </span>
              <input
                value={why}
                aria-label="เหตุผลที่ไม่อนุมัติ"
                className="field-control"
                placeholder="เช่น ซ้ำกับงานที่มอบไปแล้ว"
                onChange={(e) => setWhy(e.target.value)}
              />
            </label>
          )}
          {err && <p className="mt-2 text-[12.5px] font-semibold text-destructive">{err}</p>}
        </Sheet>
      )}
    </li>
  );
}
