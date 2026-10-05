"use client";

import { optionsOf } from "@/lib/options";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CHANGE_KIND,
  DEAL_STATUS,
  PRESALES_STATUS,
  findParty,
  quotationStateOf,
  quotationTotals,
} from "@/lib/crm-data";
import {
  closeLead,
  logActivity,
  takeOverLead,
  updateCustomer,
  leadDeleteBlock,
  removeLead,
  useCrm,
} from "@/lib/crm-store";
import { CURRENT_USER } from "@/lib/mock-data";
import { baht, initials, thaiDate, todayIso } from "@/lib/format";
import {
  BanIcon,
  ChevronRightIcon,
  HandoverIcon,
  PlusIcon,
  QuotationIcon,
  TrashIcon,
} from "./icons";
import { ConfirmDialog } from "./confirm-dialog";
import { ActivityDialog, CloseLeadDialog, TakeOverDialog } from "./lead-dialogs";
import { ProfileFacts } from "./lead-facts";
import { ChangeFromTo } from "./sales-ui";
import { findLink } from "@/lib/deep-link";
import { LeadStatusMenu } from "./lead-status-menu";

const PANES = [
  { key: "timeline", label: "ไทม์ไลน์การติดต่อ" },
  { key: "log", label: "ประวัติการเปลี่ยนแปลง" },
] as const;

type Pane = (typeof PANES)[number]["key"];

export function LeadDetailPage({ code }: { code: string }) {
  const crm = useCrm();
  const router = useRouter();
  const [pane, setPane] = useState<Pane>("timeline");
  const [logOpen, setLogOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [takeOverOpen, setTakeOverOpen] = useState(false);
  const today = todayIso();

  const customer = crm.customers.find((c) => c.code === code);
  /* เหตุผลที่ลบไม่ได้ — ว่างคือลบได้ */
  const blockWhy = leadDeleteBlock(crm, code);
  /* เปิดด้วยรหัสผู้สนใจเดิม — รายที่ปิดการขายไปแล้วเปลี่ยนหัวรหัสเป็น CUS- ลิงก์เก่าต้องยังไปถึงรายเดิม */
  const moved = customer ? undefined : findParty(crm.customers, code);
  /* พาไปที่รหัสปัจจุบัน ลิงก์ที่คัดลอกต่อจะได้เป็นรหัสลูกค้า */
  const movedTo = moved?.code;
  useEffect(() => {
    if (movedTo) router.replace(`/leads/${encodeURIComponent(movedTo)}`);
  }, [movedTo, router]);

  /* รายการของตัวเองไม่ต้องรับช่วง — ปุ่มจึงขึ้นเฉพาะของคนอื่น */
  const mine = customer?.owner === CURRENT_USER.name;

  const acts = useMemo(
    () =>
      crm.activities
        .filter((a) => a.customerCode === code)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [crm.activities, code],
  );
  const quotes = useMemo(
    () => crm.quotations.filter((q) => q.customerCode === code),
    [crm.quotations, code],
  );
  const requests = useMemo(
    () => crm.presales.filter((p) => p.customerCode === code),
    [crm.presales, code],
  );
  const deals = useMemo(
    () => crm.deals.filter((d) => d.customerCode === code),
    [crm.deals, code],
  );
  const logs = useMemo(
    () =>
      crm.changeLogs
        .filter((l) => l.customerCode === code)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [crm.changeLogs, code],
  );

  /*
   * ชื่อแท็บ "<ชื่อ> — ผู้สนใจ" ตาม mockup — ชื่ออยู่ในเครื่องผู้ใช้ จึงตั้งฝั่งหน้าจอ
   * metadata ของ Next ส่งตามมาทีหลังแล้วเขียนทับ จึงคอยตั้งกลับเมื่อ <head> เปลี่ยน
   * เฉพาะตอนยังอยู่หน้านี้ (ย้ายหน้าแล้ว URL เปลี่ยนก่อน จะไม่ไปทับชื่อของหน้าถัดไป)
   */
  const customerName = customer?.name;
  useEffect(() => {
    if (!customerName) return;
    const want = `${customerName} — ผู้สนใจ`;
    const path = window.location.pathname;
    const apply = () => {
      if (window.location.pathname === path && document.title !== want) document.title = want;
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => watch.disconnect();
  }, [customerName]);

  if (!customer) {
    return (
      <div className="panel glass px-6 py-16 text-center">
        <p className="text-lg font-semibold">
          {moved ? `${code} เปลี่ยนเป็นรหัสลูกค้า ${moved.code} แล้ว` : `ไม่พบลูกค้ารหัส ${code}`}
        </p>
        <Link
          href={moved ? `/leads/${encodeURIComponent(moved.code)}` : "/leads"}
          className="btn solid btn-solid mt-6 inline-flex"
        >
          {moved ? `ไปที่ ${moved.name}` : "กลับไปหน้ารายชื่อ"}
        </Link>
      </div>
    );
  }

  const last = acts[0]?.date ?? "";
  /** นัดติดตามครั้งถัดไป — วันนัดที่ไกลที่สุดจากทุกบันทึก ตามต้นแบบ lead-detail.html (nextFollow) */
  const nextFollow = acts
    .map((a) => a.followUp)
    .filter(Boolean)
    .sort()
    .at(-1);
  /** วันที่สร้างรายการ — ยังไม่มีช่องวันที่สร้าง ใช้การติดต่อครั้งแรกแทน */
  const createdAt = acts.at(-1)?.date ?? "";
  const hasDeal = (no: string) => crm.deals.some((d) => d.quotationNo === no);

  return (
    <div className="space-y-4">
      <div className="bar">
        <div className="min-w-0 max-sm:flex max-sm:w-full max-sm:items-start max-sm:gap-2.5">
          <div className="min-w-0 max-sm:flex-1">
          {/* เส้นทาง "ผู้สนใจ › ชื่อ" ตาม mockup แทนปุ่มย้อนกลับ — มือถือมีปุ่มย้อนกลับบนหัวจออยู่แล้ว */}
          <p className="mb-1 flex min-w-0 items-center gap-[7px] text-[13px] text-muted-foreground max-sm:hidden">
            <Link href="/leads" className="shrink-0 hover:text-primary">
              ผู้สนใจ
            </Link>
            <ChevronRightIcon className="size-[13px] shrink-0" strokeWidth={2.4} />
            <span className="truncate">{customer.name}</span>
          </p>
          {/* ชื่อผู้สนใจคือตัวบอกว่าเปิดรายไหนอยู่ จึงยังขึ้นบนมือถือ ต่างจากหัวข้อหน้าทั่วไปที่ซ่อนไว้ */}
          <h1 className="flex flex-wrap items-center gap-2.5 max-sm:flex! max-sm:text-[20px] max-sm:leading-snug">
            {customer.name}
            <LeadStatusMenu code={code} name={customer.name} status={customer.status} />
          </h1>
          <p className="num">
            {customer.code}
            {customer.leadCode && (
              <span className="text-muted-foreground"> · เดิม {customer.leadCode}</span>
            )}
          </p>
          </div>
          {/* มือถือ: ปุ่มหลักอยู่แถวเดียวกับชื่อ ชิดขวา (ต้นแบบ lead-detail.html 2 ต.ค. 2569) */}
          <Link
            href={`/quotations/new?customer=${encodeURIComponent(code)}`}
            className="btn solid btn-solid h-[34px] flex-none px-3 text-[12.5px] sm:hidden"
          >
            <QuotationIcon className="size-3.5" strokeWidth={2.2} />
            ใบเสนอราคา
          </Link>
        </div>
        {/* ปุ่มรองบนมือถือย้ายไปท้ายหน้า เหลือแต่ของจอใหญ่ตรงนี้ */}
        <div className="tools w-full flex-wrap max-sm:hidden! sm:w-auto">
          {/* ปฏิเสธได้เฉพาะรายการที่ยังเป็นผู้สนใจ (ต้นแบบ: status = lead) · เปลี่ยนกลับได้ที่ป้ายสถานะ */}
          {customer.status === "รอนัดหมาย" && (
            <button
              type="button"
              className="btn glass-thin text-destructive"
              onClick={() => setCloseOpen(true)}
            >
              <BanIcon className="size-[15px]" strokeWidth={2.2} />
              ปฏิเสธ
            </button>
          )}
          {/* ลบได้เฉพาะรายที่ยังไม่มีเอกสารผูกอยู่ — กรอกผิดคนแล้วลบทิ้งได้ ไม่ต้องทิ้งขยะไว้ในรายชื่อ
             รายที่มีคำขอ ใบเสนอราคา หรือดีลแล้ว ปุ่มยังอยู่แต่กดไม่ได้ พร้อมบอกเหตุผล */}
          <button
            type="button"
            className="btn glass-thin text-destructive disabled:cursor-not-allowed disabled:opacity-45"
            disabled={Boolean(blockWhy)}
            title={blockWhy || undefined}
            onClick={() => setDelOpen(true)}
          >
            <TrashIcon className="size-[15px]" strokeWidth={2.2} />
            ลบผู้สนใจ
          </button>
          {!mine && (
            <button
              type="button"
              className="btn glass-thin"
              onClick={() => setTakeOverOpen(true)}
            >
              <HandoverIcon className="size-[15px]" strokeWidth={2.2} />
              รับช่วงดูแล
            </button>
          )}
          <button type="button" className="btn glass-thin" onClick={() => setLogOpen(true)}>
            <PlusIcon className="size-[15px]" strokeWidth={2.2} />
            บันทึกการติดต่อ
          </button>
          <Link
            href={`/quotations/new?customer=${encodeURIComponent(code)}`}
            className="btn solid btn-solid btn-block-mobile shrink-0"
          >
            <QuotationIcon className="size-[15px]" strokeWidth={2.2} />
            สร้างใบเสนอราคา
          </Link>
        </div>
      </div>

      {customer.status === "ปฏิเสธ" && customer.closedReason && (
        <p className="rounded-xl border border-[var(--neutral)]/20 bg-[var(--neutral-soft)] px-4 py-3 text-sm text-muted-foreground">
          ปฏิเสธเพราะ {customer.closedReason}
        </p>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2.05fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* ── การ์ดโปรไฟล์: ตัวตนลูกค้าซ้าย ข้อมูลติดต่อที่แก้ได้ขวา ── */}
          <section className="glass rounded-2xl px-4 py-5 sm:px-[22px]">
            <div className="grid gap-[22px] lg:grid-cols-[210px_minmax(0,1fr)]">
              <div className="border-border pb-[18px] text-center lg:border-r lg:border-b-0 lg:pr-[22px] lg:pb-0">
                <span className="mx-auto grid size-[84px] place-items-center rounded-[26px] bg-accent text-[28px] font-semibold text-primary">
                  {initials(customer.name)}
                </span>
                <h2 className="mt-3 text-[17px] leading-snug font-semibold">{customer.name}</h2>
                <p className="num mt-1 text-[12.5px] text-muted-foreground">
                  {customer.code}
                  {customer.leadCode && ` · เดิม ${customer.leadCode}`}
                </p>
                <span className="mt-3">
                  <LeadStatusMenu code={code} name={customer.name} status={customer.status} />
                </span>
                <p className="mt-3 text-[11.5px] text-muted-foreground">
                  ผู้ดูแล
                  <b className="mt-0.5 block text-[13px] font-medium text-foreground">
                    {customer.owner}
                    {mine && " (คุณ)"}
                  </b>
                </p>
                <div className="mt-4 flex border-t border-border pt-3.5">
                  <div className="flex-1">
                    <b className="num block text-xl font-semibold">{acts.length}</b>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      ครั้งที่ติดต่อ
                    </span>
                  </div>
                  <div className="flex-1 border-l border-border">
                    <b className="num block text-[15px] leading-snug font-semibold whitespace-nowrap">
                      {last ? thaiDate(last) : "—"}
                    </b>
                    <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                      ติดต่อล่าสุด
                    </span>
                  </div>
                </div>
              </div>

              <ProfileFacts
                customer={customer}
                sources={optionsOf("leadSource")}
                onSave={(patch) => updateCustomer(code, patch)}
              />
            </div>
          </section>

          <section id="lead-timeline" className="glass rounded-2xl px-4 pb-5 sm:px-[22px]">
            <div className="tabs -mx-4 mb-4 border-b border-border px-4 sm:-mx-[22px] sm:px-[22px]">
              {PANES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={pane === p.key ? "on" : ""}
                  onClick={() => setPane(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {pane === "timeline" ? (
              /* มือถือ: ไทม์ไลน์เป็นแนวนอน เลื่อนซ้ายขวา เก่าอยู่ซ้าย ใหม่/นัดถัดไปอยู่ขวา (ต้นแบบ lead-detail.html) */
              <div className="relative pl-[26px] max-sm:flex max-sm:flex-row-reverse max-sm:justify-end max-sm:overflow-x-auto max-sm:pl-0 max-sm:[-ms-overflow-style:none] max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden">
                <span className="absolute top-1.5 bottom-1.5 left-1.5 w-0.5 bg-border max-sm:hidden" />
                {nextFollow && (
                  <Event
                    tone="next"
                    when={`${thaiDate(nextFollow)} · นัดติดตามครั้งถัดไป`}
                    body={nextFollow >= today ? "ยังไม่ถึงกำหนด" : "เลยกำหนดแล้ว"}
                  />
                )}
                {acts.length === 0 ? (
                  <p className="py-6 text-muted-foreground">ยังไม่มีบันทึกการติดต่อ</p>
                ) : (
                  acts.map((a, i) => (
                    <Event
                      key={a.id}
                      tone={i === acts.length - 1 ? "first" : "normal"}
                      when={thaiDate(a.date)}
                      channel={a.channel}
                      body={a.summary}
                      next={a.nextAction}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {logs.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 py-3">
                      <span className="num w-[104px] shrink-0 text-[12.5px] text-muted-foreground">
                        {thaiDate(l.at)}
                      </span>
                      <ChangeFromTo log={l} />
                      <span className="w-full text-[12.5px] text-muted-foreground sm:w-auto">
                        {CHANGE_KIND[l.kind]}
                        {l.reason ? ` · ${l.reason}` : ""}
                      </span>
                    </div>
                  ))}
                {/* แถวต้นทาง — การสร้างรายการ ตามต้นแบบ lead-detail.html อยู่ล่างสุดเสมอ */}
                <div className="flex flex-wrap items-start gap-2 py-3">
                  <span className="num w-[104px] shrink-0 text-[12.5px] text-muted-foreground">
                    {createdAt ? thaiDate(createdAt) : "—"}
                  </span>
                  <span className="min-w-0 text-[13.5px]">
                    <b className="font-semibold">สร้างรายการผู้สนใจ</b>
                    {customer.source && (
                      <span className="block text-[12.5px] text-muted-foreground">บันทึกจาก{customer.source}</span>
                    )}
                    <span className="block text-[12.5px] text-muted-foreground">สถานะเริ่มต้น รอนัดหมาย</span>
                  </span>
                </div>
                {logs.length === 0 && (
                  <p className="py-4 text-center text-[13px] text-muted-foreground">
                    ยังไม่มีการเปลี่ยนสถานะหรือรับช่วงดูแลหลังจากนั้น
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="glass rounded-2xl px-4 py-5 sm:px-[22px]">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              บันทึกล่าสุด
              {/* ตามต้นแบบ — พาไปดูไทม์ไลน์การติดต่อทั้งหมด */}
              {acts.length > 0 && (
                <button
                  type="button"
                  className="btn glass-thin btn-mini ml-auto"
                  onClick={() => {
                    setPane("timeline");
                    document.getElementById("lead-timeline")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  ดูทั้งหมด
                </button>
              )}
            </h2>
            {acts.slice(0, 2).map((a) => (
              <div key={a.id} className="glass-thin mt-3 rounded-xl px-3.5 py-3">
                <p className="text-[13.5px] leading-relaxed break-words">{a.summary}</p>
                <span className="mt-2 block text-[11.5px] text-muted-foreground">
                  จากการติดต่อ {thaiDate(a.date)}
                </span>
              </div>
            ))}
            {acts.length === 0 && (
              <p className="mt-3 text-[13px] text-muted-foreground">ยังไม่มีบันทึกการติดต่อ</p>
            )}
          </section>

          <DocCard
            title="ใบเสนอราคา"
            action={{ label: "สร้างใหม่", href: `/quotations/new?customer=${encodeURIComponent(code)}` }}
            empty="ยังไม่เคยออกใบเสนอราคาให้ลูกค้ารายนี้"
            rows={quotes.map((q) => {
              const st = quotationStateOf(q, hasDeal(q.no), today);
              return {
                key: q.id,
                href: `/quotations/${encodeURIComponent(q.no)}`,
                main: q.no,
                sub: `${baht(quotationTotals(q).grand)} บาท`,
                tag: st.label,
                cls: st.cls,
              };
            })}
          />

          <DocCard
            title="คำขอก่อนการขาย"
            action={{ label: "ส่งคำขอ", href: `/presales/new?customer=${encodeURIComponent(code)}` }}
            empty="ยังไม่มีคำขอก่อนการขาย"
            rows={requests.map((r) => ({
              key: r.id,
              href: findLink("/presales", r.no),
              main: r.no,
              sub: `${r.kind} · กำหนดส่ง ${thaiDate(r.due)}`,
              tag: r.status,
              cls: PRESALES_STATUS[r.status],
            }))}
          />

          <DocCard
            title="ดีล"
            empty="ยังไม่มีดีล"
            rows={deals.map((d) => ({
              key: d.id,
              href: findLink("/deals", d.no),
              main: d.no,
              sub: `${baht(d.total)} บาท · ปิดเมื่อ ${thaiDate(d.closedAt)}`,
              tag: d.status,
              cls: DEAL_STATUS[d.status],
            }))}
          />
        </div>
      </div>

      {/* มือถือ: ปุ่มรองอยู่ท้ายหน้า หลังการ์ดทั้งหมด (ต้นแบบ lead-detail.html) */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        {customer.status === "รอนัดหมาย" && (
          <button
            type="button"
            className="btn glass-thin h-[46px] justify-center text-destructive"
            onClick={() => setCloseOpen(true)}
          >
            <BanIcon className="size-[15px]" strokeWidth={2.2} />
            ปฏิเสธ
          </button>
        )}
        <button
          type="button"
          className="btn glass-thin h-[46px] justify-center text-destructive disabled:cursor-not-allowed disabled:opacity-45"
          disabled={Boolean(blockWhy)}
          title={blockWhy || undefined}
          onClick={() => setDelOpen(true)}
        >
          <TrashIcon className="size-[15px]" strokeWidth={2.2} />
          ลบผู้สนใจ
        </button>
        {!mine && (
          <button
            type="button"
            className="btn glass-thin h-[46px] justify-center"
            onClick={() => setTakeOverOpen(true)}
          >
            <HandoverIcon className="size-[15px]" strokeWidth={2.2} />
            รับช่วงดูแล
          </button>
        )}
        <button
          type="button"
          className="btn glass-thin h-[46px] justify-center"
          onClick={() => setLogOpen(true)}
        >
          <PlusIcon className="size-[15px]" strokeWidth={2.2} />
          บันทึกการติดต่อ
        </button>
      </div>

      {logOpen && (
        <ActivityDialog
          customerName={customer.name}
          channels={optionsOf("leadChannel")}
          onClose={() => setLogOpen(false)}
          onSubmit={(v) => {
            logActivity({ customerCode: code, ...v });
            setLogOpen(false);
          }}
        />
      )}
      {takeOverOpen && (
        <TakeOverDialog
          customerName={customer.name}
          currentOwner={customer.owner}
          onClose={() => setTakeOverOpen(false)}
          onSubmit={(reason) => {
            takeOverLead(code, reason);
            setTakeOverOpen(false);
          }}
        />
      )}
      {closeOpen && (
        <CloseLeadDialog
          customerName={customer.name}
          code={customer.code}
          onClose={() => setCloseOpen(false)}
          onSubmit={(reason) => {
            closeLead(code, reason);
            setCloseOpen(false);
          }}
        />
      )}

      {/* ลบแล้วเรียกคืนไม่ได้ ต้องถามก่อนเสมอ แล้วพากลับไปหน้ารายชื่อ เพราะหน้านี้จะไม่มีข้อมูลแล้ว */}
      <ConfirmDialog
        open={delOpen}
        tone="destructive"
        title={`ลบ ${customer.name} ออกจากรายชื่อ`}
        description="บันทึกการติดต่อและประวัติการเปลี่ยนแปลงของรายนี้จะถูกลบไปด้วย"
        detail="ลบแล้วเรียกคืนไม่ได้"
        confirmLabel="ลบผู้สนใจ"
        onCancel={() => setDelOpen(false)}
        onConfirm={() => {
          setDelOpen(false);
          if (removeLead(code)) router.push("/leads");
        }}
      />
    </div>
  );
}

function Event({
  tone,
  when,
  channel,
  body,
  next,
}: {
  tone: "next" | "first" | "normal";
  when: string;
  channel?: string;
  body: string;
  next?: string;
}) {
  const dot =
    tone === "next"
      ? "border-[var(--warning)]"
      : tone === "first"
        ? "border-[var(--success)]"
        : "border-[var(--info)]";
  return (
    <div className="relative pb-[18px] max-sm:w-[min(220px,62vw)] max-sm:flex-none max-sm:pt-[26px] max-sm:pr-3 max-sm:pb-0">
      {/* เส้นเวลาแนวนอนของมือถือ — ต่อกันทุกใบจนเป็นเส้นเดียว */}
      <span aria-hidden="true" className="absolute top-[7px] right-0 left-0 hidden h-0.5 bg-[#E9DEE1] max-sm:block" />
      <span
        className={`absolute top-1 -left-[26px] size-3.5 rounded-full border-[3px] bg-white ${dot} max-sm:top-[1px] max-sm:left-0 max-sm:border-0 max-sm:bg-primary max-sm:ring-4 max-sm:ring-[#FDECEE]`}
      />
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground max-sm:text-[13px] max-sm:font-bold max-sm:text-foreground">
        {when}
        {channel && (
          <span className="glass-thin rounded-full px-2 py-px text-[11px] max-sm:font-semibold max-sm:text-muted-foreground">{channel}</span>
        )}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed break-words max-sm:rounded-xl max-sm:bg-[#FAF6F7] max-sm:px-3 max-sm:py-2.5 max-sm:text-[13px]">{body}</p>
      {next && (
        <p className="mt-1.5 inline-block rounded-lg bg-[var(--warning-soft)] px-2.5 py-1 text-[12.5px] text-[var(--warning)]">
          สิ่งที่ต้องทำต่อ · {next}
        </p>
      )}
    </div>
  );
}

function DocCard({
  title,
  action,
  empty,
  rows,
}: {
  title: string;
  action?: { label: string; href: string };
  empty: string;
  rows: { key: string; href: string; main: string; sub: string; tag: string; cls: string }[];
}) {
  return (
    <section className="glass rounded-2xl px-4 py-5 sm:px-[22px]">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        {title}
        {action && (
          <Link href={action.href} className="btn glass-thin btn-mini ml-auto">
            {action.label}
          </Link>
        )}
      </h2>
      {rows.length === 0 ? (
        <p className="py-5 text-center text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-1 divide-y divide-border">
          {rows.map((r) => (
            <Link
              key={r.key}
              href={r.href}
              className="flex items-center gap-3 py-2.5 transition-colors hover:text-primary"
            >
              <span className="min-w-0 flex-1">
                <b className="num block text-[13.5px] font-medium">{r.main}</b>
                <span className="block text-[11.5px] text-muted-foreground">{r.sub}</span>
              </span>
              <span className={`tag shrink-0 ${r.cls}`}>
                <i />
                {r.tag}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
