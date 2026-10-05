"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useFindParam } from "@/lib/deep-link";
import {
  EXPIRING_DAYS,
  QUOTATION_STATUS,
  isLatestQuotation,
  quotationChain,
  quotationTotals,
  quotationValidUntil,
  type Quotation,
  type QuotationStatus,
} from "@/lib/crm-data";
import { useCrm } from "@/lib/crm-store";
import { baht, daysBetween, thaiDate, todayIso } from "@/lib/format";
import { ChevronDownIcon, ClockIcon, FileIcon, PlusIcon, RotateIcon } from "./icons";
import { ChainTable } from "./quotations-page";
import { Pager, SearchBox, Who, usePaged } from "./sales-ui";

const PER_PAGE = 7;

/** แท็บตามสถานะ ตามต้นแบบ acc-quotations.html (ไม่มีร่าง เพราะออกเลขทันทีที่บันทึก) */
const TABS: ("all" | QuotationStatus)[] = [
  "all",
  "ส่งแล้ว",
  "ตอบรับ",
  "ปฏิเสธ",
  "หมดอายุ",
  "แทนที่แล้ว",
];

/*
 * ใบเสนอราคาของฝ่ายบัญชี — ต้นแบบ dose-erp-maz/acc-quotations.html
 * เห็นเฉพาะลูกค้าที่ปิดการขายแล้ว (ห้ามมีผู้สนใจปน) · ออกเลขทันทีที่บันทึก แก้ใบเดิมไม่ได้
 * เปลี่ยนอะไรให้ "ออกใบใหม่แทนใบนี้" ใบเดิมเป็นแทนที่แล้ว · ประวัติคือจำนวนใบที่ออกแทนกันมา
 */
export function AccQuotationsPage() {
  const crm = useCrm();
  const router = useRouter();
  const find = useFindParam();
  const [query, setQuery] = useState(find);
  const [tab, setTab] = useState<"all" | QuotationStatus>("all");
  const [soonOnly, setSoonOnly] = useState(false);
  const [openChain, setOpenChain] = useState("");
  const today = todayIso();

  /* ลูกค้าที่ปิดการขายแล้วเท่านั้น — ชื่อกับรหัสเอามาจากทะเบียนลูกค้าชุดเดียวกับฝ่ายขาย */
  const closed = useMemo(
    () => new Map(crm.customers.filter((c) => c.status === "ปิดงาน").map((c) => [c.code, c.name])),
    [crm.customers],
  );
  const hasDeal = useMemo(
    () => new Set(crm.deals.filter((d) => d.quotationNo).map((d) => d.quotationNo)),
    [crm.deals],
  );

  const validOf = (q: Quotation) => quotationValidUntil(q);
  const daysLeft = (q: Quotation) => daysBetween(today, validOf(q));
  const isSoon = (q: Quotation) =>
    q.status === "ส่งแล้ว" &&
    !hasDeal.has(q.no) &&
    !q.replacedBy &&
    daysLeft(q) >= 0 &&
    daysLeft(q) <= EXPIRING_DAYS;

  const mine = useMemo(
    () => crm.quotations.filter((q) => q.no && closed.has(q.customerCode)),
    [crm.quotations, closed],
  );
  const scope = useMemo(() => {
    const qq = query.trim().toLowerCase();
    return mine.filter((q) => {
      if (soonOnly && !isSoon(q)) return false;
      if (!qq) return true;
      const name = closed.get(q.customerCode) ?? "";
      return `${q.no} ${name} ${q.customerCode}`.toLowerCase().includes(qq);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, query, soonOnly, closed, hasDeal, today]);
  const rows = tab === "all" ? scope : scope.filter((q) => q.status === tab);
  const paged = usePaged(rows, PER_PAGE);
  const total = rows.reduce((sum, q) => sum + quotationTotals(q).grand, 0);

  const docHref = (q: Quotation) => `/acc/quotations/${encodeURIComponent(q.no)}`;
  const chainOf = (q: Quotation) => quotationChain(crm.quotations, q.no);
  const canReplace = (q: Quotation) => isLatestQuotation(crm.quotations, q);

  const countOf = (t: "all" | QuotationStatus) =>
    t === "all" ? scope.length : scope.filter((q) => q.status === t).length;

  const actions = (q: Quotation) => (
    <>
      {canReplace(q) && (
        <Link
          href={`/acc/quotations/new?replace=${encodeURIComponent(q.no)}`}
          className="lnk"
          title="ออกใบใหม่แทนใบนี้ (ใบนี้แก้ไม่ได้)"
        >
          <RotateIcon className="size-3.5" strokeWidth={2} />
          ออกใบใหม่แทนใบนี้
        </Link>
      )}
      <Link href={docHref(q)} className="iconbtn glass-thin" aria-label="เปิดเอกสาร" title="เปิดเอกสาร">
        <FileIcon className="size-3.5" strokeWidth={2} />
      </Link>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <p className="max-md:hidden!">พบ {rows.length} ฉบับ · เฉพาะลูกค้าที่ปิดการขายแล้ว</p>
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          <SearchBox
            className="max-md:hidden!"
            value={query}
            onChange={(v) => {
              setQuery(v);
              paged.setPage(1);
            }}
            placeholder="ค้นหาเลขที่เอกสารหรือชื่อลูกค้า"
          />
          <Link
            href="/acc/quotations/new"
            className="btn solid btn-solid btn-block-mobile fab-mobile shrink-0"
          >
            <PlusIcon className="size-[15px]" strokeWidth={2.2} />
            <span className="lbl">สร้างใบเสนอราคา</span>
          </Link>
        </div>
      </div>

      <section className="panel glass flex flex-col">
        <div className="strip gap-2">
          {/* แท็บสถานะ — เลื่อนข้างได้บนจอแคบ */}
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-2">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  paged.setPage(1);
                }}
                aria-pressed={tab === t}
                className={`btn shrink-0 ${tab === t ? "bg-accent font-semibold text-primary" : "glass-thin"}`}
              >
                {t === "all" ? "ทั้งหมด" : t}
                <b className="num text-[11.5px] font-semibold opacity-70">{countOf(t)}</b>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setSoonOnly((v) => !v);
              paged.setPage(1);
            }}
            aria-pressed={soonOnly}
            className={`btn my-2 shrink-0 ${soonOnly ? "bg-accent font-semibold text-primary" : "glass-thin"}`}
          >
            <ClockIcon className="size-[13px]" strokeWidth={2} />
            ใกล้หมดอายุ
          </button>
        </div>

        <div className="scroll-stable hidden min-h-0 flex-1 overflow-auto md:block">
          <table className="data-table min-w-[980px]">
            <thead>
              <tr>
                <th style={{ width: 165 }}>เลขที่เอกสาร</th>
                <th>ลูกค้า</th>
                <th style={{ width: 108 }}>วันที่ออก</th>
                <th style={{ width: 124 }}>มีผลถึง</th>
                <th style={{ width: 84 }}>ออกในนาม</th>
                <th className="r" style={{ width: 118 }}>ยอดรวม</th>
                <th style={{ width: 112 }}>สถานะ</th>
                <th style={{ width: 196 }} />
              </tr>
            </thead>
            <tbody>
              {paged.list.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-[50px] text-center text-muted-foreground">
                    ไม่พบใบเสนอราคาที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                paged.list.flatMap((q) => {
                  const chain = chainOf(q);
                  const open = openChain === q.no;
                  const out = [
                    <tr key={q.id} onClick={() => router.push(docHref(q))} style={{ cursor: "pointer" }}>
                      <td className="num muted">
                        {q.no}
                        {chain.length > 1 && (
                          <button
                            type="button"
                            className={`ml-1.5 inline-flex h-[22px] items-center gap-1 rounded-full border px-[9px] text-[10.5px] font-semibold ${
                              open
                                ? "border-primary bg-accent text-primary"
                                : "border-border text-muted-foreground"
                            }`}
                            title="ดูประวัติใบที่ออกแทนกันมา"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenChain(open ? "" : q.no);
                            }}
                          >
                            ฉบับที่ {chain.length}
                            <ChevronDownIcon
                              className={`size-2.5 ${open ? "rotate-180" : ""}`}
                              strokeWidth={3}
                            />
                          </button>
                        )}
                        {q.replacedBy && <span className="why">ถูกแทนด้วยใบ {q.replacedBy}</span>}
                        {q.replaces && <span className="why">แทนใบ {q.replaces}</span>}
                      </td>
                      <td>
                        <Who name={closed.get(q.customerCode) ?? q.customerCode} sub={q.customerCode} />
                      </td>
                      <td className="num muted whitespace-nowrap">{thaiDate(q.issued)}</td>
                      <td className="num muted">
                        {thaiDate(validOf(q))}
                        {isSoon(q) && <span className="diff early">อีก {daysLeft(q)} วัน</span>}
                      </td>
                      <td className="muted">{q.issuer}</td>
                      <td className="r money">{baht(quotationTotals(q).grand)}</td>
                      <td>
                        <span className={`tag ${QUOTATION_STATUS[q.status]}`}>{q.status}</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span className="flex flex-wrap items-center justify-end gap-1.5">{actions(q)}</span>
                      </td>
                    </tr>,
                  ];
                  if (open && chain.length > 1)
                    out.push(
                      <tr key={`${q.id}-chain`}>
                        <td colSpan={8} className="bg-muted/40 p-0">
                          <ChainTable chain={chain} />
                        </td>
                      </tr>,
                    );
                  return out;
                })
              )}
            </tbody>
          </table>
        </div>

        {/* มือถือ: การ์ดต่อใบ */}
        <ul className="divide-y divide-border md:hidden">
          {paged.list.length === 0 ? (
            <li className="px-5 py-12 text-center text-muted-foreground">
              ไม่พบใบเสนอราคาที่ตรงกับเงื่อนไข
            </li>
          ) : (
            paged.list.map((q) => (
              <li key={q.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <Who name={closed.get(q.customerCode) ?? q.customerCode} sub={q.no} />
                  <b className="money num shrink-0 text-[15px]">{baht(quotationTotals(q).grand)}</b>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  ออกในนาม {q.issuer} · ออก {thaiDate(q.issued)} · มีผลถึง {thaiDate(validOf(q))}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`tag ${QUOTATION_STATUS[q.status]}`}>{q.status}</span>
                  {chainOf(q).length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      ออกแทนกันมาแล้ว {chainOf(q).length} ฉบับ
                    </span>
                  )}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link href={docHref(q)} className="btn glass-thin h-10 justify-center">
                    เปิดเอกสาร
                  </Link>
                  {canReplace(q) && (
                    <Link
                      href={`/acc/quotations/new?replace=${encodeURIComponent(q.no)}`}
                      className="btn solid btn-solid h-10 justify-center"
                    >
                      ออกใบใหม่แทนใบนี้
                    </Link>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>

        <div className="foot flex-col items-stretch gap-3 text-center sm:flex-row sm:items-center sm:text-left">
          <span>{paged.range("ฉบับ")}</span>
          <span className="sum">
            ยอดรวมที่กรอง<b>{baht(total)}</b> บาท
          </span>
          {paged.list.length > 0 && (
            <Pager page={paged.page} maxPage={paged.maxPage} onChange={paged.setPage} />
          )}
        </div>
      </section>
    </div>
  );
}
