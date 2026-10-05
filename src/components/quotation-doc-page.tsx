"use client";

import Link from "next/link";
import { useState } from "react";
import { canBillQuotation, quotationTotals } from "@/lib/crm-data";
import { useCrm } from "@/lib/crm-store";
import { findLink } from "@/lib/deep-link";
import { todayIso } from "@/lib/format";
import { ChevronLeftIcon, DownloadIcon, PrintIcon } from "./icons";
import { BillQuotationDialog } from "./quotation-dialogs";
import { QuotationPaper } from "./quotation-paper";

/**
 * ceo = เปิดจากหน้าดีลของ CEO (/ceo/sales/quotations/<เลขที่>) · acc = เปิดจากใบเสนอราคาของบัญชี
 * ลิงก์ทุกตัวพากลับหน้าของบทบาทตัวเอง ไม่พาไปหน้าของฝ่ายขาย (กติกาห้ามลิงก์ข้ามบทบาท)
 */
export function QuotationDocPage({
  no,
  rev,
  ceo = false,
  acc = false,
}: {
  no: string;
  rev?: number;
  ceo?: boolean;
  acc?: boolean;
}) {
  const back = ceo ? "/ceo/deals" : acc ? "/acc/quotations" : "/quotations";
  const docHref = ceo
    ? `/ceo/sales/quotations/${encodeURIComponent(no)}`
    : acc
      ? `/acc/quotations/${encodeURIComponent(no)}`
      : `/quotations/${encodeURIComponent(no)}`;
  const crm = useCrm();
  /* ทุกใบมีเลขที่เสมอ — เผื่อลิงก์เก่าที่อ้างด้วยรหัสของใบ ก็ยังเปิดได้ */
  const current = crm.quotations.find((x) => x.no === no) ?? crm.quotations.find((x) => x.id === no);
  /* ฉบับเก่าเปิดจากสำเนาที่เก็บไว้ตอนแก้ไข — ไม่มีสำเนาก็แสดงฉบับปัจจุบัน */
  const old =
    current && rev && rev !== current.revision
      ? crm.quotationRevisions.find((r) => r.quotationId === current.id && r.revision === rev)?.snapshot
      : undefined;
  const q = old ?? current;
  const customer = crm.customers.find((c) => c.code === q?.customerCode);
  /* ใบนี้กลายเป็นดีลแล้วหรือยัง — ฝั่ง PM กับบัญชีลิงก์เข้ามาที่หน้านี้
     ถ้าไม่มีทางออกต่อ ก็ต้องถอยกลับไปตั้งต้นค้นใหม่เอง */
  const deal = crm.deals.find((d) => d.quotationNo === no);
  /* ส่งไปวางบิลจากหน้าเอกสาร (ต้นแบบ quotation-view.html) — เงื่อนไขเดียวกับหน้ารายการ */
  const [billing, setBilling] = useState(false);
  const canBill =
    Boolean(current) && !old && !ceo && !acc && canBillQuotation(current!, Boolean(deal), todayIso());
  const docLink = (n: string) => (
    <Link
      href={
        ceo
          ? `/ceo/sales/quotations/${encodeURIComponent(n)}`
          : acc
            ? `/acc/quotations/${encodeURIComponent(n)}`
            : `/quotations/${encodeURIComponent(n)}`
      }
      className="lnk-code"
    >
      {n}
    </Link>
  );

  if (!q) {
    return (
      <div className="panel glass px-6 py-16 text-center">
        <p className="text-lg font-semibold">ไม่พบเอกสารเลขที่ {no}</p>
        <Link href={back} className="btn solid btn-solid mt-6 inline-flex">
          กลับไปหน้ารายการ
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bar no-print">
        <div className="min-w-0">
          <Link href={back} className="btn glass-thin btn-mini mb-1.5">
            <ChevronLeftIcon className="size-3.5" strokeWidth={2.4} />
            {ceo ? "ดีล" : "ใบเสนอราคา"}
          </Link>
          <h1 className="num">{q.no || "ร่าง"}</h1>
          <p>
            {ceo || acc ? (
              customer?.name ?? q.customerCode
            ) : (
              <Link href={`/leads/${q.customerCode}`} className="lnk-code">
                {customer?.name ?? q.customerCode}
              </Link>
            )}
            {old && (
              <>
                {" · "}
                <b className="font-semibold text-[var(--warning)]">ฉบับเก่า</b>{" "}
                <Link href={docHref} className="lnk">
                  ดูฉบับปัจจุบัน
                </Link>
              </>
            )}
          </p>
          {/* ความสัมพันธ์กับใบอื่น — ออกใบใหม่แทน / แทนใบ · อ้างอิงคำขอก่อนการขาย */}
          {(q.replacedBy || q.replaces || q.ps) && (
            <p className="mt-0.5 text-[12.5px]">
              {q.replacedBy ? (
                <>ออกใบใหม่แทน {docLink(q.replacedBy)}</>
              ) : q.replaces ? (
                <>แทนใบ {docLink(q.replaces)}</>
              ) : null}
              {q.ps && (
                <>
                  {(q.replacedBy || q.replaces) && " · "}
                  อ้างอิงคำขอ{" "}
                  {ceo || acc ? (
                    q.ps
                  ) : (
                    <Link href={findLink("/presales", q.ps)} className="lnk-code">
                      {q.ps}
                    </Link>
                  )}
                </>
              )}
            </p>
          )}
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          {deal && (
            <Link
              href={`${ceo ? "/ceo/deals" : acc ? "/acc/billing" : "/deals"}?find=${encodeURIComponent(deal.no)}`}
              className="btn glass-thin"
            >
              {acc ? `ดูงวดของดีล ${deal.no}` : `ดูดีล ${deal.no}`}
            </Link>
          )}
          {/* แก้ใบเดิมไม่ได้ — เปลี่ยนอะไรต้องออกใบใหม่แทนใบนี้ */}
          {!ceo && !old && q.no && !q.replacedBy && (
            <Link
              href={`${acc ? "/acc" : ""}/quotations/new?replace=${encodeURIComponent(q.no)}`}
              className="btn glass-thin"
            >
              ออกใบใหม่แทนใบนี้
            </Link>
          )}
          {canBill && (
            <button type="button" className="btn solid btn-solid" onClick={() => setBilling(true)}>
              ส่งไปวางบิล
            </button>
          )}
          <button type="button" className="btn glass-thin" onClick={() => window.print()}>
            <PrintIcon className="size-[15px]" strokeWidth={1.9} />
            พิมพ์
          </button>
          <button
            type="button"
            className="btn solid btn-solid btn-block-mobile shrink-0"
            onClick={() => window.print()}
          >
            <DownloadIcon className="size-[15px]" strokeWidth={2} />
            ดาวน์โหลด PDF
          </button>
        </div>
      </div>

      {billing && current && (
        <BillQuotationDialog
          quotation={current}
          customerName={customer?.name ?? current.customerCode}
          variant="view"
          onClose={() => setBilling(false)}
        />
      )}

      <div className="flex flex-col items-center gap-5">
        <QuotationPaper
          doc={{
            no: q.no,
            revision: q.revision,
            issued: q.issued,
            validDays: q.validDays,
            issuer: q.issuer,
            body: q.body,
            terms: q.terms,
            totals: quotationTotals(q),
            customer: customer
              ? {
                  name: customer.name,
                  taxId: customer.taxId,
                  address: customer.address,
                  contact: customer.contact,
                  phone: customer.phone,
                  email: customer.email,
                }
              : null,
          }}
        />
      </div>
    </div>
  );
}
