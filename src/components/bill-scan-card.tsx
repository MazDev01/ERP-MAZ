"use client";

/*
 * อ่านบิลผู้ขาย แล้วบัญชีตรวจก่อนนำเข้า (รอบที่ 142 · Requirement รอบ 12)
 *
 * ขั้นตอนบนหน้าจอ
 *   1. บัญชีเลือกไฟล์บิล (PDF หรือรูป) หรือวางข้อความจากบิลที่ผู้ขายส่งมาทางอีเมล
 *   2. ระบบแยกเป็นช่อง ๆ ให้ — ผู้ขาย เลขผู้เสียภาษี วันที่ ยอดก่อนภาษี ภาษี ยอดรวม
 *   3. บัญชี "ตรวจและแก้" ทุกช่องได้ก่อน แล้วค่อยกดเก็บเข้ารายการรอตรวจ
 *   4. ออกเอกสารจริงเอง (เช่นหนังสือรับรองหัก ณ ที่จ่าย) แล้วผูกเลขกลับมาปิดใบ
 *
 * ระบบไม่สร้างเอกสารการเงินให้เองจากบิล — ข้อนี้คือหัวใจของที่เจ้าของสั่งไว้
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { billReady, readBill, type BillDraft } from "@/lib/bill-ocr";
import {
  fetchBillScans,
  sbAddBillScan,
  sbBillDrop,
  sbBillImport,
  sbReadBillFile,
  sbUploadBill,
  type BillScan,
} from "@/lib/supabase/bill-scans";
import { baht, thaiDate } from "@/lib/format";
import { Sheet } from "./lead-dialogs";

const EMPTY: BillDraft = { vendor: "", taxId: "", date: "", no: "", base: 0, vat: 0, total: 0, got: [] };

const SAY: Record<string, string> = {
  no_keys: "ยังไม่ได้ต่อบริการอ่านรูปบิล — วางข้อความจากบิลลงช่องด้านล่างแทนได้",
  ocr_refused: "บริการอ่านบิลไม่ตอบ ลองใหม่หรือวางข้อความเอง",
  ocr_failed: "อ่านไฟล์ไม่สำเร็จ วางข้อความจากบิลแทนได้",
  no_account: "เซสชันหมดอายุ เข้าสู่ระบบใหม่",
  too_big: "ไฟล์ใหญ่เกิน 10 MB",
  not_allowed: "เฉพาะฝ่ายบัญชีที่ทำรายการนี้ได้",
  need_doc: "ใส่เลขเอกสารที่ออกจากบิลใบนี้",
  need_why: "บอกเหตุผลที่ทิ้งบิลใบนี้",
  not_open: "ใบนี้ปิดไปแล้ว",
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
};
const say = (k: string) => SAY[k] ?? "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";

const num = (v: string) => Number(v.replace(/,/g, "")) || 0;

export function BillScanCard() {
  const [rows, setRows] = useState<BillScan[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");

  const reload = () => void fetchBillScans().then(setRows);
  useEffect(reload, []);

  const waiting = rows.filter((r) => r.status === "new");

  return (
    <section className="glass rounded-[15px] px-5 py-[18px] max-sm:px-4 max-sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">
          อ่านบิลผู้ขาย{waiting.length > 0 && <span className="num"> · รอตรวจ {waiting.length}</span>}
        </h2>
        <button
          type="button"
          className="btn glass-thin btn-mini"
          onClick={() => {
            setMsg("");
            setOpen(true);
          }}
        >
          อ่านบิลใหม่
        </button>
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        ระบบแยกข้อมูลจากบิลให้เป็นร่าง — ฝ่ายบัญชีตรวจและแก้ก่อนนำเข้าเสมอ ระบบไม่ออกเอกสารให้เอง
      </p>
      {msg && <p className="mt-2 text-[12.5px] font-semibold text-primary">{msg}</p>}

      {rows.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">ยังไม่มีบิลที่อ่านเข้ามา</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.slice(0, 8).map((r) => (
            <li key={r.no} className="rounded-[12px] border border-border px-3.5 py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                <span className="num">{r.no}</span>
                <span>{r.draft.vendor || "ไม่รู้ชื่อผู้ขาย"}</span>
                {r.status === "new" ? (
                  <span className="tag t-job">
                    <i />
                    รอบัญชีตรวจ
                  </span>
                ) : r.status === "imported" ? (
                  <span className="tag t-ok">
                    <i />
                    นำเข้าแล้ว <span className="num">{r.docNo}</span>
                  </span>
                ) : (
                  <span className="tag t-late">
                    <i />
                    ทิ้งแล้ว
                  </span>
                )}
              </p>
              <p className="num mt-0.5 text-[12.5px] text-muted-foreground">
                {r.draft.date ? thaiDate(String(r.draft.date)) : "ไม่รู้วันที่"} ·{" "}
                {r.draft.base ? `${baht(Number(r.draft.base))} บาท` : "ไม่รู้ยอด"}
                {r.draft.taxId ? ` · เลขผู้เสียภาษี ${r.draft.taxId}` : ""}
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                อ่านเข้ามาโดย {r.by}
                {r.status === "dropped" && r.why ? ` · ทิ้งเพราะ ${r.why}` : ""}
              </p>
              {r.status === "new" && <ReviewRow scan={r} onDone={(m) => { setMsg(m); reload(); }} />}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ReadSheet
          onClose={() => setOpen(false)}
          onSaved={(no) => {
            setOpen(false);
            setMsg(`เก็บบิล ${no} ไว้รอตรวจแล้ว`);
            reload();
          }}
        />
      )}
    </section>
  );
}

/* ── ปุ่มของบิลที่รอตรวจ ─────────────────────────────────────── */

function ReviewRow({ scan, onDone }: { scan: BillScan; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<"" | "import" | "drop">("");
  const [doc, setDoc] = useState("");
  const [why, setWhy] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res =
      mode === "import" ? await sbBillImport(scan.no, doc, scan.draft) : await sbBillDrop(scan.no, why);
    setBusy(false);
    if (!res.ok) {
      setErr(say(res.reason));
      return;
    }
    setMode("");
    onDone(mode === "import" ? `นำเข้าบิล ${scan.no} แล้ว` : `ทิ้งบิล ${scan.no} แล้ว`);
  }

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* ออกเอกสารจริงที่หน้าแบบ 50 ทวิ แล้วค่อยกลับมาผูกเลข */}
        <Link href="/acc/wht/cert?type=juristic" className="btn glass-thin btn-mini">
          ออกหนังสือรับรอง
        </Link>
        <button type="button" className="btn glass-thin btn-mini" onClick={() => { setErr(""); setMode("import"); }}>
          ผูกเลขเอกสาร
        </button>
        <button type="button" className="btn glass-thin btn-mini" onClick={() => { setErr(""); setMode("drop"); }}>
          ทิ้งบิลนี้
        </button>
      </div>
      {mode && (
        <Sheet
          title={mode === "import" ? `นำเข้าบิล ${scan.no}` : `ทิ้งบิล ${scan.no}`}
          narrow
          onClose={() => setMode("")}
          footer={
            <>
              <button type="button" className="btn glass-thin" onClick={() => setMode("")}>
                ยกเลิก
              </button>
              <button type="button" className="btn solid btn-solid" disabled={busy} onClick={() => void run()}>
                {mode === "import" ? "นำเข้า" : "ทิ้งบิล"}
              </button>
            </>
          }
        >
          {mode === "import" ? (
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
                เลขเอกสารที่ออกจากบิลใบนี้<em className="ml-0.5 text-primary not-italic">*</em>
              </span>
              <input value={doc} onChange={(e) => setDoc(e.target.value)} className="field-control num" placeholder="เช่น 50TW-6911-003" />
              <span className="mt-1.5 block text-[11.5px] text-muted-foreground">
                ปิดแล้วเปิดใหม่ไม่ได้ · ถ้าออกเอกสารผิด ให้ออกใบใหม่แล้วอ่านบิลเข้ามาอีกครั้ง
              </span>
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
                เหตุผล<em className="ml-0.5 text-primary not-italic">*</em>
              </span>
              <input value={why} onChange={(e) => setWhy(e.target.value)} className="field-control" placeholder="เช่น บิลซ้ำกับใบก่อนหน้า" />
            </label>
          )}
          {err && <p className="mt-2 text-[12.5px] font-semibold text-destructive">{err}</p>}
        </Sheet>
      )}
    </>
  );
}

/* ── กล่องอ่านบิลใหม่ ────────────────────────────────────────── */

function ReadSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (no: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<BillDraft>(EMPTY);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /** อ่านข้อความจากไฟล์ แล้วแยกเป็นช่องให้ตรวจ */
  async function read(f: File) {
    setFile(f);
    setErr("");
    setBusy(true);
    const res = await sbReadBillFile(f);
    setBusy(false);
    if (!res.ok) {
      setNote(say(res.reason));
      return;
    }
    setNote("อ่านข้อความจากไฟล์ได้แล้ว — ตรวจค่าทุกช่องก่อนเก็บ");
    setText(res.text);
    setDraft(readBill(res.text));
  }

  /** วางข้อความเอง — แยกช่องให้ทันทีที่พิมพ์ครบ */
  function paste(v: string) {
    setText(v);
    setDraft(readBill(v));
  }

  const ready = billReady(draft);

  async function save() {
    if (!ready.ok) {
      setErr(`ยังกรอกไม่ครบ: ${ready.miss.join(" · ")}`);
      return;
    }
    setBusy(true);
    let path = "";
    if (file) {
      const up = await sbUploadBill(file);
      if (!up.ok) {
        setBusy(false);
        setErr(say(up.reason));
        return;
      }
      path = up.path;
    }
    const res = await sbAddBillScan({ path, text, draft });
    setBusy(false);
    if (!res.ok) {
      setErr(say(res.reason));
      return;
    }
    onSaved(res.no ?? "");
  }

  const set = <K extends keyof BillDraft>(k: K, v: BillDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const guessed = (k: string) => draft.got.includes(k);

  return (
    <Sheet
      title="อ่านบิลผู้ขาย"
      mid
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid" disabled={busy} onClick={() => void save()}>
            เก็บไว้รอตรวจ
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">ไฟล์บิล (PDF หรือรูป)</span>
          <input
            type="file"
            accept="application/pdf,image/*"
            aria-label="ไฟล์บิล"
            className="field-control"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
          />
        </label>
        {note && <p className="text-[12px] text-muted-foreground">{note}</p>}

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
            ข้อความบนบิล (วางจากอีเมลหรือ PDF ได้)
          </span>
          <textarea
            value={text}
            rows={5}
            aria-label="ข้อความบนบิล"
            className="field-control"
            placeholder={"ใบกำกับภาษี\nร้านกระดาษดี จำกัด\nเลขประจำตัวผู้เสียภาษี 0105551234567\nวันที่ 20/11/2569\nรวมเป็นเงิน 4,200.00\nภาษีมูลค่าเพิ่ม 294.00\nรวมทั้งสิ้น 4,494.00"}
            onChange={(e) => paste(e.target.value)}
          />
        </label>

        <div className="rounded-[12px] border border-border px-3.5 py-3">
          <p className="text-[12.5px] font-semibold">ค่าที่ระบบแยกให้ — ตรวจและแก้ได้ก่อนเก็บ</p>
          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            <Fld label="ผู้ขาย" hint={guessed("vendor")} value={draft.vendor} onChange={(v) => set("vendor", v)} />
            <Fld label="เลขประจำตัวผู้เสียภาษี" hint={guessed("taxId")} value={draft.taxId} onChange={(v) => set("taxId", v.replace(/\D/g, "").slice(0, 13))} num />
            <Fld label="วันที่บนบิล" hint={guessed("date")} value={draft.date} onChange={(v) => set("date", v)} num placeholder="2026-11-20" />
            <Fld label="เลขที่บิลของผู้ขาย" hint={guessed("no")} value={draft.no} onChange={(v) => set("no", v)} num />
            <Fld label="ยอดก่อนภาษี" hint={guessed("base")} value={String(draft.base || "")} onChange={(v) => set("base", num(v))} num />
            <Fld label="ภาษีมูลค่าเพิ่ม" hint={guessed("vat")} value={String(draft.vat || "")} onChange={(v) => set("vat", num(v))} num />
            <Fld label="ยอดรวมทั้งสิ้น" hint={guessed("total")} value={String(draft.total || "")} onChange={(v) => set("total", num(v))} num />
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            ช่องที่มีป้าย &quot;ระบบอ่านให้&quot; คือค่าที่เดามาจากบิล ช่องที่ไม่มีป้ายคือกรอกเอง
          </p>
        </div>
        {err && <p className="text-[12.5px] font-semibold text-destructive">{err}</p>}
      </div>
    </Sheet>
  );
}

function Fld({
  label,
  value,
  onChange,
  hint,
  num: isNum,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** ค่านี้ระบบอ่านมาจากบิล ไม่ใช่บัญชีพิมพ์เอง */
  hint?: boolean;
  num?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        {label}
        {hint && <em className="rounded-full bg-muted px-1.5 py-px text-[10.5px] not-italic">ระบบอ่านให้</em>}
      </span>
      <input
        value={value}
        aria-label={label}
        placeholder={placeholder}
        className={`field-control ${isNum ? "num" : ""}`}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
