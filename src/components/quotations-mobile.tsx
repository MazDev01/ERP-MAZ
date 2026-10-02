"use client";

/*
 * ผู้สนใจและใบเสนอราคา บนมือถือ (ต้นแบบ quotations-mobile.html ที่เจ้าของส่งมา 29 ก.ย. 2569)
 *
 * จอเล็กไม่ได้ดูเป็น "รายใบ" เหมือนจอคอม แต่ดูเป็น "รายลูกค้า" ว่าใครยังไม่ได้ทำใบให้
 * สามแท็บ — ยังไม่มีใบ · มีใบแล้ว · ปฏิเสธแล้ว
 * ปฏิเสธ = พนักงานขายตัดสินว่าไม่ทำใบให้ ต้องบอกเหตุผลเสมอ (ใช้ closeLead ชุดเดียวกับหน้าผู้สนใจ
 * จึงไม่เกิดสถานะซ้อนกันสองที่ และหน้าผู้สนใจบนจอคอมเห็นเหตุผลเดียวกัน)
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { closeLead, reopenLead, useCrm } from "@/lib/crm-store";
import {
  canBillQuotation,
  quotationTotals,
  quotationValidUntil,
  type Customer,
  type Quotation,
} from "@/lib/crm-data";
import { serviceLabel } from "@/lib/pm-data";
import { baht, daysBetween, initials, thaiDate, todayIso } from "@/lib/format";
import { ChevronRightIcon, CloseIcon, FileIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";

type Tab = "todo" | "has" | "no";

const TAB_LABEL: Record<Tab, string> = {
  todo: "ยังไม่มีใบ",
  has: "มีใบแล้ว",
  no: "ปฏิเสธแล้ว",
};

const EMPTY: Record<Tab, string> = {
  todo: "ทำใบเสนอราคาครบทุกรายแล้ว",
  has: "ยังไม่มีลูกค้าที่มีใบเสนอราคา",
  no: "ยังไม่มีลูกค้าที่ปฏิเสธ",
};

/* เหตุผลที่พนักงานขายไม่ทำใบให้ — ชุดเดียวกับต้นแบบ · เลือก "อื่นๆ" ต้องพิมพ์เพิ่ม */
const WHY = [
  "ไม่อยู่ในบริการของเรา",
  "งบประมาณลูกค้าไม่พอ",
  "ติดต่อลูกค้าไม่ได้",
  "ลูกค้ายังไม่พร้อม",
  "อื่นๆ",
];

const TINT = [
  "bg-[#FCE3E7] text-[#C0121F]",
  "bg-[#E3EEFC] text-[#1F6FD0]",
  "bg-[#DDF2E6] text-[#14875A]",
  "bg-[#FDEDD6] text-[#B4630B]",
  "bg-[#ECE6FA] text-[#5B3FBF]",
];

const CHIP = {
  rose: "bg-[#FCE3E7] text-[#C0121F]",
  peach: "bg-[#FDEDD6] text-[#B4630B]",
  mint: "bg-[#DDF2E6] text-[#14875A]",
  grey: "bg-[#F1ECED] text-[#6E6164]",
  lilac: "bg-[#ECE6FA] text-[#5B3FBF]",
} as const;

export function QuotationsMobile() {
  const crm = useCrm();
  const today = todayIso();
  const [tab, setTab] = useState<Tab>("todo");
  /** ลูกค้าที่กำลังจะกดปฏิเสธ — ต้องเลือกเหตุผลก่อนถึงยืนยันได้ */
  const [declining, setDeclining] = useState<Customer | null>(null);
  /** คำค้นในรายการ (ค้นเฉพาะการ์ดที่แสดงอยู่ในแท็บนั้น) */
  const [q, setQ] = useState("");

  const hasDeal = useMemo(
    () => new Set(crm.deals.filter((d) => d.quotationNo).map((d) => d.quotationNo)),
    [crm.deals],
  );

  const rows = useMemo(
    () =>
      crm.customers.map((c, i) => {
        /* ใบที่ถูกออกใบใหม่แทนแล้วไม่นับ — ดูเฉพาะใบที่ยังมีผลอยู่ ใบล่าสุดขึ้นก่อน */
        const qs = crm.quotations
          .filter((q) => q.customerCode === c.code && !q.replacedBy)
          .sort((a, b) => (a.issued < b.issued ? 1 : -1));
        const t: Tab = c.status === "ปฏิเสธ" ? "no" : qs.length ? "has" : "todo";
        const last = crm.activities
          .filter((a) => a.customerCode === c.code)
          .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        return { c, qs, tab: t, last, tint: TINT[i % TINT.length] };
      }),
    [crm.customers, crm.quotations, crm.activities],
  );

  const count = (t: Tab) => rows.filter((r) => r.tab === t).length;
  /* ค้นหาในแท็บที่เปิดอยู่ — ชื่อ ผู้ติดต่อ เบอร์ สรุปการคุย และที่มา (ต้นแบบ quotations-mobile.html 2 ต.ค. 2569) */
  const key = q.trim().toLowerCase().replace(/[\s-]/g, "");
  const list = rows.filter((r) => {
    if (r.tab !== tab) return false;
    if (!key) return true;
    const hay = `${r.c.name} ${r.c.contact} ${r.c.phone} ${r.last?.summary ?? ""} ${r.c.source}`;
    return hay.toLowerCase().replace(/[\s-]/g, "").includes(key);
  });

  /** สถานะของใบล่าสุด — คิดจากดีล วันหมดอายุ และการปฏิเสธ ไม่ได้เก็บเป็นช่องแยก */
  function stateOf(q: Quotation): [string, string] {
    if (q.status === "ร่าง") return [CHIP.grey, "ฉบับร่าง"];
    if (hasDeal.has(q.no)) return [CHIP.mint, "ได้งานแล้ว"];
    if (q.status === "ปฏิเสธ") return [CHIP.rose, "ลูกค้าปฏิเสธใบนี้"];
    if (!canBillQuotation(q, false, today)) return [CHIP.grey, "หมดอายุแล้ว"];
    const left = daysBetween(today, quotationValidUntil(q));
    return [CHIP.peach, left <= 7 ? `รอตอบ เหลือ ${left} วัน` : "รอลูกค้าตอบ"];
  }

  return (
    <div className="space-y-3 md:hidden">
      <label className="flex h-11 items-center gap-2 rounded-full border border-border bg-card px-3.5">
        <SearchIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2.2} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาชื่อลูกค้า ผู้ติดต่อ หรือเบอร์โทร"
          aria-label="ค้นหาผู้สนใจและใบเสนอราคา"
          className="min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted-foreground"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="ล้างคำค้น"
            className="grid size-[26px] flex-none place-items-center rounded-full bg-muted text-muted-foreground"
          >
            <CloseIcon className="size-3" strokeWidth={3} />
          </button>
        )}
      </label>

      {/* แท็บพร้อมจำนวน — เห็นทันทีว่าเหลือกี่รายที่ยังไม่ได้ทำใบ */}
      <nav
        className="grid grid-cols-3 border-b-[1.5px] border-border"
        role="tablist"
        aria-label="สถานะลูกค้า"
      >
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
          const on = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t)}
              className={`relative h-[46px] text-[14.5px] font-semibold ${
                on ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {TAB_LABEL[t]}
              <span
                className={`num ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] px-1.5 align-[1px] text-[11px] ${
                  on ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {count(t)}
              </span>
              {on && (
                <i className="absolute inset-x-[18%] -bottom-[1.5px] h-[3px] rounded-t-[3px] bg-primary" />
              )}
            </button>
          );
        })}
      </nav>

      {list.length === 0 ? (
        <p className="glass rounded-[18px] px-5 py-12 text-center text-[13.5px] text-muted-foreground">
          {EMPTY[tab]}
        </p>
      ) : (
        <ul className="space-y-3.5">
          {list.map(({ c, qs, last, tint }) => {
            const q = qs[0];
            return (
              <li key={c.code} className="glass rounded-[22px] p-3.5">
                {/* กดส่วนบนของการ์ด = เปิดรายละเอียดผู้สนใจ ปุ่มด้านล่างยังทำงานของมันเอง */}
                <Link
                  href={`/leads/${encodeURIComponent(c.code)}`}
                  className="grid grid-cols-[62px_minmax(0,1fr)] gap-3.5 text-foreground"
                >

                  <span
                    className={`grid size-[62px] place-items-center rounded-[18px] text-[20px] font-bold ${tint}`}
                    aria-hidden="true"
                  >
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <ChevronRightIcon
                        className="order-last mt-0.5 size-4 flex-none text-muted-foreground"
                        strokeWidth={2.4}
                        aria-hidden="true"
                      />
                      <b className="line-clamp-2 text-[15.5px] leading-snug font-bold">{c.name}</b>
                      {q ? (
                        <span className="num shrink-0 text-right text-[14px] font-bold">
                          {baht(quotationTotals(q).grand)}
                          <small className="block text-[10.5px] font-medium text-muted-foreground">
                            ใบล่าสุด
                          </small>
                        </span>
                      ) : (
                        last?.followUp && (
                          <span className="shrink-0 text-right text-[11px] text-muted-foreground">
                            นัดติดตาม
                            <b className="num block text-[13px] text-foreground">
                              {thaiDate(last.followUp)}
                            </b>
                          </span>
                        )
                      )}
                    </div>

                    {q && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                        <FileIcon className="size-[15px] flex-none text-primary" strokeWidth={2} />
                        <span className="truncate">{q.status === "ร่าง" ? `ร่าง ${q.id}` : q.no}</span>
                        <i className="size-1 flex-none rounded-full bg-muted-foreground/60" />
                        <span className="truncate">{q.service ? serviceLabel(q.service) : "—"}</span>
                      </p>
                    )}

                    <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                      <UserIcon className="size-[15px] flex-none text-primary" strokeWidth={2} />
                      <span className="truncate">
                        {c.contact} · {c.phone}
                      </span>
                    </p>

                    {!q && last?.summary && (
                      <p className="mt-1 line-clamp-2 text-[12.5px] text-muted-foreground">
                        {last.summary}
                      </p>
                    )}

                    {q ? (
                      (() => {
                        const [cls, text] = stateOf(q);
                        return (
                          <span
                            className={`mt-1.5 inline-block rounded-lg px-2.5 py-1 text-[11.5px] font-bold ${cls}`}
                          >
                            {text}
                            {qs.length > 1 ? ` · ทั้งหมด ${qs.length} ใบ` : ""}
                          </span>
                        );
                      })()
                    ) : (
                      <span
                        className={`mt-1.5 inline-block rounded-lg px-2.5 py-1 text-[11.5px] font-bold ${CHIP.lilac}`}
                      >
                        มาจาก {c.source || "ไม่ระบุ"}
                      </span>
                    )}
                  </div>
                </Link>

                {c.status === "ปฏิเสธ" && (
                  <p className="mt-2.5 rounded-xl bg-muted px-3 py-2.5 text-[12.5px] text-muted-foreground">
                    <b className="font-semibold text-foreground">เหตุผล:</b> {c.closedReason || "—"}
                  </p>
                )}

                {/* ปุ่มงานหลักของการ์ด — ตามต้นแบบ สองช่องเท่ากัน ปุ่มขวาเป็นปุ่มทึบ */}
                {c.status === "ปฏิเสธ" ? (
                  <button
                    type="button"
                    className="btn glass-thin mt-3.5 h-9! w-full justify-center rounded-[10px]! text-[13px]"
                    onClick={() => reopenLead(c.code)}
                  >
                    ยกเลิกการปฏิเสธ
                  </button>
                ) : q ? (
                  <div className="mt-3.5 flex justify-center gap-2">
                    <Link
                      href={`/quotations/${encodeURIComponent(q.no || q.id)}`}
                      className="btn glass-thin h-9! justify-center rounded-[10px]! px-3.5 text-[13px]"
                    >
                      ดูรายละเอียด
                    </Link>
                    <Link
                      href={
                        q.no
                          ? `/quotations/new?from=${encodeURIComponent(q.no)}`
                          : `/quotations/new?draft=${encodeURIComponent(q.id)}`
                      }
                      className="btn solid btn-solid h-9! justify-center rounded-[10px]! px-3.5 text-[13px]"
                    >
                      {q.no ? "สร้างฉบับใหม่" : "แก้ไขร่าง"}
                    </Link>
                  </div>
                ) : (
                  <div className="mt-3.5 flex justify-center gap-2">
                    <button
                      type="button"
                      className="btn glass-thin h-9! justify-center rounded-[10px]! px-3.5 text-[13px]"
                      onClick={() => setDeclining(c)}
                    >
                      ปฏิเสธ
                    </button>
                    <Link
                      href={`/quotations/new?cus=${encodeURIComponent(c.code)}`}
                      className="btn solid btn-solid h-9! justify-center rounded-[10px]! px-3.5 text-[13px]"
                    >
                      <PlusIcon className="size-3.5" strokeWidth={2.4} />
                      สร้างใบเสนอราคา
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {declining && <DeclineSheet customer={declining} onClose={() => setDeclining(null)} />}
    </div>
  );
}

/** กล่องถามเหตุผลที่ไม่ทำใบให้ — ไม่เลือกเหตุผลยืนยันไม่ได้ และเลือก "อื่นๆ" ต้องพิมพ์ */
function DeclineSheet({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [why, setWhy] = useState("");
  const [note, setNote] = useState("");
  const [warn, setWarn] = useState("");

  function send() {
    if (!why) return setWarn("เลือกเหตุผลก่อน");
    if (why === "อื่นๆ" && !note.trim()) return setWarn("กรอกรายละเอียดของเหตุผลอื่นๆ");
    closeLead(customer.code, note.trim() ? `${why} — ${note.trim()}` : why);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-80 flex items-end justify-center bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label="ไม่ทำใบเสนอราคาให้ลูกค้ารายนี้"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-solid max-h-[90dvh] w-full overflow-y-auto rounded-t-[26px] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]">
        <span className="mx-auto mb-3.5 block h-1 w-10 rounded bg-border" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold">ไม่ทำใบเสนอราคาให้ลูกค้ารายนี้</h2>
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {customer.name} · {customer.contact}
            </p>
          </div>
          <button type="button" className="iconbtn glass-thin" onClick={onClose} aria-label="ปิด">
            <CloseIcon className="size-[15px]" strokeWidth={2.2} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {WHY.map((w) => (
            <label
              key={w}
              className={`flex items-center gap-2.5 rounded-[14px] border-[1.5px] px-3.5 py-3 text-[14px] ${
                why === w ? "border-primary bg-card" : "border-transparent bg-muted"
              }`}
            >
              <input
                type="radio"
                name="why"
                className="size-[18px] accent-[var(--primary)]"
                checked={why === w}
                onChange={() => {
                  setWhy(w);
                  setWarn("");
                }}
              />
              {w}
            </label>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setWarn("");
          }}
          placeholder="รายละเอียดเพิ่มเติม (ถ้าเลือกอื่นๆ ต้องกรอก)"
          aria-label="รายละเอียดเพิ่มเติม"
          className="mt-2.5 min-h-[76px] w-full rounded-[14px] border-[1.5px] border-border bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ring"
        />
        <p className="mt-1.5 min-h-[18px] text-[12.5px] font-semibold text-destructive" aria-live="polite">
          {warn}
        </p>

        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" className="btn glass-thin h-11 justify-center" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="btn solid btn-solid h-11 justify-center" onClick={send}>
            ยืนยันปฏิเสธ
          </button>
        </div>
      </div>
    </div>
  );
}
