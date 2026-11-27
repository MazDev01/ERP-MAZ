"use client";

/*
 * ต่อบริการเดิม — PM แจ้งบัญชีออกใบเสนอราคา/ใบแจ้งหนี้ (รอบที่ 139 · Requirement รอบ 7)
 *
 * ลูกค้าเก่าติดต่อ PM เองว่าจะต่อบริการ ไม่ได้กลับไปเข้าทางฝ่ายขาย
 *   ฝั่ง PM   — การ์ดในหน้าโปรเจค กดแจ้งแล้วคำขอถึงบัญชีทันที (PmBillingAsk)
 *   ฝั่งบัญชี — การ์ดคำขอที่ค้างอยู่ในหน้าใบเสนอราคาและหน้าวางบิล (AccBillingAsks)
 *
 * ลูกค้า บริการ และชื่อคนแจ้งมาจากโปรเจคกับบัญชีที่ล็อกอิน (ฐานข้อมูลเติมให้) กรอกแทนกันไม่ได้
 * ลูกค้าต่อสัญญาคือ "งานใหม่" เสมอตาม SRS — คำขอนี้จึงไม่แก้โปรเจคเดิม แค่สั่งงานบัญชี
 */

import Link from "next/link";
import { useState } from "react";
import {
  BILL_KIND,
  askBilling,
  closeBilling,
  dropBilling,
  useBillingReq,
} from "@/lib/billing-req-store";
import type { BillKind } from "@/lib/supabase/billing-requests";
import { thaiDate } from "@/lib/format";
import { serviceLabel } from "@/lib/pm-data";
import { Sheet } from "./lead-dialogs";

const KINDS: BillKind[] = ["quotation", "invoice"];

/* ── ฝั่ง PM: การ์ดในหน้าโปรเจค ─────────────────────────────── */

export function PmBillingAsk({
  pj,
  service,
  readOnly,
}: {
  pj: string;
  service: string;
  /** GM เปิดหน้าของ PM แบบดูอย่างเดียว */
  readOnly?: boolean;
}) {
  const all = useBillingReq();
  const mine = all.filter((r) => r.pj === pj);
  const open = mine.filter((r) => r.status === "open");
  const [asking, setAsking] = useState(false);
  const [kind, setKind] = useState<BillKind>("quotation");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const res = await askBilling(pj, kind, note, service);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.message);
      return;
    }
    setAsking(false);
    setNote("");
    setMsg(`แจ้งบัญชีแล้ว เลขที่คำขอ ${res.no ?? ""}`);
  }

  return (
    <section className="glass rounded-[15px] px-5 py-[18px] max-sm:px-4 max-sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">ต่อบริการเดิม</h2>
        {!readOnly && (
          <button
            type="button"
            className="btn glass-thin btn-mini"
            onClick={() => {
              setMsg("");
              setAsking(true);
            }}
          >
            แจ้งบัญชี
          </button>
        )}
      </div>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        ลูกค้าติดต่อมาต่อบริการเอง แจ้งบัญชีออกใบเสนอราคาหรือใบแจ้งหนี้ได้เลย ไม่ต้องเปิดผู้สนใจใหม่ ·
        งานที่ลูกค้าซื้อต่อจะเป็นโปรเจคใหม่
      </p>

      {msg && <p className="mt-2 text-[12.5px] font-semibold text-primary">{msg}</p>}

      {mine.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted-foreground">ยังไม่มีคำขอของโปรเจคนี้</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {mine.map((r) => (
            <li key={r.no} className="rounded-[12px] border border-border px-3.5 py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
                <span className="num">{r.no}</span>
                <span>{BILL_KIND[r.kind]}</span>
                {r.status === "open" ? (
                  <span className="tag t-job">
                    <i />
                    รอบัญชี
                  </span>
                ) : r.status === "done" ? (
                  <span className="tag t-ok">
                    <i />
                    ออกแล้ว <span className="num">{r.docNo}</span>
                  </span>
                ) : (
                  <span className="tag t-late">
                    <i />
                    ยกเลิก
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{r.note}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                แจ้งโดย {r.by} · {thaiDate(r.at.slice(0, 10))}
                {r.status === "cancelled" && r.why ? ` · เหตุผล ${r.why}` : ""}
              </p>
              {!readOnly && r.status === "open" && (
                <CancelButton no={r.no} onDone={(m) => setMsg(m)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {open.length > 0 && !readOnly && (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          คำขอประเภทเดียวกันที่ยังค้างอยู่ แจ้งซ้ำไม่ได้ ต้องรอบัญชีปิดหรือยกเลิกก่อน
        </p>
      )}

      {asking && (
        <Sheet
          title="แจ้งบัญชี · ต่อบริการเดิม"
          narrow
          onClose={() => setAsking(false)}
          footer={
            <>
              <button type="button" className="btn glass-thin" onClick={() => setAsking(false)}>
                ยกเลิก
              </button>
              <button type="button" className="btn solid btn-solid" disabled={busy} onClick={() => void send()}>
                แจ้งบัญชี
              </button>
            </>
          }
        >
          <div className="grid gap-3">
            <div>
              <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">ขออะไร</span>
              <div className="seg glass-thin" role="group" aria-label="ประเภทเอกสาร">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={kind === k ? "on" : ""}
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {BILL_KIND[k]}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {kind === "quotation"
                  ? "ยังไม่ได้ตกลงราคา ให้บัญชีออกใบเสนอราคาให้ลูกค้าก่อน"
                  : "ตกลงราคากับลูกค้าแล้ว ให้บัญชีออกใบแจ้งหนี้ได้เลย"}
              </p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
                ลูกค้าขออะไร<em className="ml-0.5 text-primary not-italic">*</em>
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="เช่น ต่อดูแลเว็บอีก 1 ปี คุยไว้ 36,000 บาท เริ่ม 1 ม.ค. ลูกค้าขอใบเสนอราคาภายในสัปดาห์นี้"
                className="field-control"
              />
            </label>
            {service && (
              <p className="text-[12px] text-muted-foreground">
                บริการที่แจ้งไป: {serviceLabel(service)} (ตามโปรเจคเดิม) · บัญชีแก้ได้ตอนออกเอกสาร
              </p>
            )}
            {msg && <p className="text-[12.5px] font-semibold text-destructive">{msg}</p>}
          </div>
        </Sheet>
      )}
    </section>
  );
}

function CancelButton({ no, onDone }: { no: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn glass-thin btn-mini mt-2" onClick={() => setOpen(true)}>
        ยกเลิกคำขอ
      </button>
      {open && (
        <Sheet
          title={`ยกเลิกคำขอ ${no}`}
          narrow
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn glass-thin" onClick={() => setOpen(false)}>
                ไม่ยกเลิก
              </button>
              <button
                type="button"
                className="btn solid btn-solid"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void dropBilling(no, why).then((r) => {
                    setBusy(false);
                    if (!r.ok) {
                      setErr(r.message);
                      return;
                    }
                    setOpen(false);
                    onDone(`ยกเลิกคำขอ ${no} แล้ว`);
                  });
                }}
              >
                ยกเลิกคำขอ
              </button>
            </>
          }
        >
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
              เหตุผล<em className="ml-0.5 text-primary not-italic">*</em>
            </span>
            <input value={why} onChange={(e) => setWhy(e.target.value)} className="field-control" placeholder="เช่น ลูกค้าเลื่อนไปปีหน้า" />
          </label>
          {err && <p className="mt-2 text-[12.5px] font-semibold text-destructive">{err}</p>}
        </Sheet>
      )}
    </>
  );
}

/* ── ฝั่งบัญชี: คำขอที่ค้างอยู่ ──────────────────────────────── */

/** การ์ดคำขอจาก PM ที่ยังไม่ได้ออกเอกสาร — วางบนหน้าใบเสนอราคาและหน้าวางบิล */
export function AccBillingAsks({ kind }: { kind: BillKind }) {
  const all = useBillingReq();
  const open = all.filter((r) => r.status === "open" && r.kind === kind);
  const [msg, setMsg] = useState("");
  if (open.length === 0) return null;

  return (
    <section className="glass rounded-[15px] px-5 py-[18px] max-sm:px-4 max-sm:py-4">
      <h2 className="text-[15px] font-bold">
        คำขอจากฝ่ายโปรเจค · {BILL_KIND[kind]} <span className="num">{open.length}</span>
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        ลูกค้าเก่าติดต่อ PM มาต่อบริการ — ออกเอกสารแล้วผูกเลขที่กลับมา คำขอจะปิดเอง
      </p>
      {msg && <p className="mt-2 text-[12.5px] font-semibold text-primary">{msg}</p>}
      <ul className="mt-3 space-y-2">
        {open.map((r) => (
          <li key={r.no} className="rounded-[12px] border border-border px-3.5 py-2.5">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
              <span className="num">{r.no}</span>
              <span>{r.customerName}</span>
              {r.service && <span className="tag t-info"><i />{serviceLabel(r.service)}</span>}
              {r.pj && <span className="num text-[11.5px] font-normal text-muted-foreground">{r.pj}</span>}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{r.note}</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              แจ้งโดย {r.by} · {thaiDate(r.at.slice(0, 10))}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {kind === "quotation" ? (
                <Link
                  href={`/acc/quotations/new?customer=${encodeURIComponent(r.customerCode)}&req=${encodeURIComponent(r.no)}`}
                  className="btn glass-thin btn-mini"
                >
                  ออกใบเสนอราคา
                </Link>
              ) : (
                <Link href={`/acc/billing?find=${encodeURIComponent(r.customerName)}`} className="btn glass-thin btn-mini">
                  ไปหน้าวางบิล
                </Link>
              )}
              <DoneButton no={r.no} onDone={setMsg} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DoneButton({ no, onDone }: { no: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn glass-thin btn-mini" onClick={() => setOpen(true)}>
        ผูกเลขเอกสาร
      </button>
      {open && (
        <Sheet
          title={`ปิดคำขอ ${no}`}
          narrow
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="btn glass-thin" onClick={() => setOpen(false)}>
                ยังไม่ปิด
              </button>
              <button
                type="button"
                className="btn solid btn-solid"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void closeBilling(no, doc).then((r) => {
                    setBusy(false);
                    if (!r.ok) {
                      setErr(r.message);
                      return;
                    }
                    setOpen(false);
                    onDone(`ปิดคำขอ ${no} แล้ว`);
                  });
                }}
              >
                ปิดคำขอ
              </button>
            </>
          }
        >
          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold text-muted-foreground">
              เลขที่เอกสารที่ออกให้ลูกค้า<em className="ml-0.5 text-primary not-italic">*</em>
            </span>
            <input
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              className="field-control num"
              placeholder="เช่น MAZ69-110041 หรือ INV69-110041"
            />
          </label>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            ปิดแล้วเปิดใหม่ไม่ได้ · ถ้าลูกค้าเปลี่ยนใจภายหลัง ให้ PM แจ้งคำขอใบใหม่
          </p>
          {err && <p className="mt-2 text-[12.5px] font-semibold text-destructive">{err}</p>}
        </Sheet>
      )}
    </>
  );
}
