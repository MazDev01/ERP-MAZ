"use client";

/*
 * งานรอตรวจ — งานที่ทีมส่งกลับมาให้ PM ตรวจก่อนปิด (ตามต้นแบบ pm-reviews.html)
 *
 * หน้านี้คู่กับ "งานที่ได้รับ" ของพนักงาน (my-tasks-page.tsx) งานใบเดียวกันเดินสองทาง
 *   ทีมกดส่ง → status "sent" โผล่ที่นี่ → PM กดผ่าน (done) หรือส่งกลับแก้ (revise)
 *
 * ตีกลับต้องบอกเหตุผลเสมอ ไม่งั้นคนทำไม่รู้ว่าต้องแก้อะไรแล้วจะส่งกลับมาแบบเดิม
 */

import { useMemo, useState } from "react";
import { bkkStamp, daysBetween, thaiDate, todayIso } from "@/lib/format";
import { lastSub, projName, type Project, type ProjectTask } from "@/lib/pm-data";
import { approveWorkFlow } from "@/lib/flow";
import { memberName, memberOf, sendBackWork, usePm } from "@/lib/pm-store";
import { roleLabel } from "@/lib/pm-data";
import { hrPos } from "@/lib/hr-data";
import { useHr } from "@/lib/hr-store";
import { Field, Sheet } from "./lead-dialogs";
import { ReadOnlyNote, usePmReadOnly } from "./pm-readonly";

/** รอเกินกี่วันถึงขึ้นเตือนว่าค้างนาน — ตรงกับต้นแบบ */
const WAITED_HOT = 3;

type Row = { p: Project; t: ProjectTask };

/** ส่งเมื่อ — นับเป็นวันแบบต้นแบบ: วันนี้ / เมื่อวาน / N วันก่อน */
function agoText(day: string, today: string) {
  const w = daysBetween(day, today);
  return w <= 0 ? "วันนี้" : w === 1 ? "เมื่อวาน" : `${w} วันก่อน`;
}

/*
 * ตำแหน่งของผู้ส่ง — อ่านตำแหน่งตามสัญญาจ้างจากทะเบียนฝ่ายบุคคล (จับคู่ด้วยชื่อ
 * เพราะรหัสพนักงานของสองชุดยังชนกันที่ E11 ดู erp-maz-hr-pages) ไม่เจอค่อยใช้ตำแหน่งในทีม
 */
function usePosition() {
  const hr = useHr();
  return (id: string) => {
    const name = memberName(id);
    const e = hr.emp.find((x) => x.name === name);
    if (e) return hrPos(e.pos).label;
    return memberOf(id)?.roles.map(roleLabel).join(" · ") ?? "";
  };
}

export function PmReviewsPage() {
  const pm = usePm();
  const today = todayIso();
  const [open, setOpen] = useState<Row | null>(null);
  const position = usePosition();
  const ro = usePmReadOnly();

  const rows = useMemo<Row[]>(() => {
    const out = pm.projects
      .filter((p) => p.status !== "cancelled")
      .flatMap((p) => p.tasks.filter((t) => t.status === "sent").map((t) => ({ p, t })));
    /* ที่ส่งมาก่อนขึ้นก่อน คนที่รอนานที่สุดควรได้คำตอบก่อน */
    return out.sort((a, b) =>
      (lastSub(a.t)?.at ?? "").localeCompare(lastSub(b.t)?.at ?? ""),
    );
  }, [pm.projects]);

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <p>งานที่ทีมส่งมาให้ตรวจก่อนปิดงาน</p>
        </div>
      </div>
      <ReadOnlyNote />

      <section className="panel glass flex min-w-0 flex-col">
        <div className="strip">
          <h2 className="py-2.5 text-[14.5px] font-bold">
            งานรอตรวจ {rows.length ? `${rows.length} งาน` : ""}
          </h2>
        </div>
        {/* มือถือ: การ์ดทั้งใบกดเปิดกล่องตรวจงาน (เหมือนกดทั้งแถวบนจอใหญ่) ชื่องานเด่น ผู้ส่งกับโปรเจคอยู่บรรทัดรอง */}
        <ul className="space-y-2.5 px-3.5 py-3.5 sm:hidden">
          {rows.length === 0 ? (
            <li className="py-9 text-center text-[13px] text-muted-foreground">ไม่มีงานรอตรวจ</li>
          ) : (
            rows.map(({ p, t }) => {
              const sub = lastSub(t);
              const day = sub?.at.split(" ")[0] ?? "";
              const waited = day ? daysBetween(day, today) : 0;
              const who = sub?.by ?? t.whos[0] ?? "";
              return (
                <li key={`${p.deal}-${t.name}`}>
                  <button
                    type="button"
                    onClick={() => setOpen({ p, t })}
                    className="block w-full rounded-[13px] border border-border bg-card px-3.5 py-3 text-left"
                  >
                    <b className="block text-[14px] leading-snug font-bold">{t.name}</b>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{projName(p)}</span>
                    <span className="mt-2.5 flex items-end gap-3">
                      <span className="min-w-0 flex-1">
                        <b className="block text-[12.5px] leading-snug font-semibold">{memberName(who)}</b>
                        <em className="block text-[11px] leading-snug text-muted-foreground not-italic">
                          {position(who)}
                        </em>
                      </span>
                      <span className="flex-none text-right">
                        <span className="num block text-[11.5px] text-muted-foreground">
                          {day ? `ส่ง ${agoText(day, today)}` : "—"}
                        </span>
                        {waited >= WAITED_HOT && (
                          <em className="block text-[11px] font-semibold text-destructive not-italic">
                            รอมาแล้ว {waited} วัน
                          </em>
                        )}
                      </span>
                    </span>
                    {!ro && (
                      <span className="btn glass-thin mt-3 h-10 w-full justify-center">ตรวจงาน</span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="scroll-stable min-h-0 flex-1 overflow-auto max-sm:hidden">
          <table className="data-table cards-sm min-w-[760px]">
            <thead>
              <tr>
                <th>งาน</th>
                <th style={{ width: 190 }}>ผู้ส่ง</th>
                <th style={{ width: 180 }}>โปรเจค</th>
                <th style={{ width: 170 }}>ส่งเมื่อ</th>
                <th className="c" style={{ width: 130 }} aria-label="ตรวจงาน" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-9 text-center text-muted-foreground">
                    ไม่มีงานรอตรวจ
                  </td>
                </tr>
              ) : (
                rows.map(({ p, t }) => {
                  const sub = lastSub(t);
                  const day = sub?.at.split(" ")[0] ?? "";
                  const waited = day ? daysBetween(day, today) : 0;
                  const who = sub?.by ?? t.whos[0] ?? "";
                  return (
                    /* กดทั้งแถวเปิดกล่องตรวจงานได้ ตามต้นแบบ */
                    <tr
                      key={`${p.deal}-${t.name}`}
                      className="cursor-pointer"
                      onClick={() => setOpen({ p, t })}
                    >
                      <td data-label="งาน">{t.name}</td>
                      <td data-label="ผู้ส่ง">
                        <b className="block font-semibold">{memberName(who)}</b>
                        <em className="block text-[11.5px] text-muted-foreground not-italic">{position(who)}</em>
                      </td>
                      <td data-label="โปรเจค" className="muted">
                        {projName(p)}
                      </td>
                      <td
                        data-label="ส่งเมื่อ"
                        className="num muted"
                        title={waited >= WAITED_HOT ? `รอนานเกิน ${WAITED_HOT} วัน` : undefined}
                      >
                        {day ? agoText(day, today) : "—"}
                        {waited >= WAITED_HOT && (
                          <em className="block text-[11px] font-semibold text-destructive not-italic">
                            รอมาแล้ว {waited} วัน
                          </em>
                        )}
                      </td>
                      <td data-label="จัดการ" className="c">
                        {!ro && <button
                          type="button"
                          className="btn glass-thin btn-mini"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen({ p, t });
                          }}
                        >
                          ตรวจงาน
                        </button>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {open && (
        <ReviewDialog
          row={open}
          onClose={() => setOpen(null)}
          onDone={() => setOpen(null)}
        />
      )}
    </div>
  );
}

// ─── กล่องตรวจงาน ─────────────────────────────────────────────────

function ReviewDialog({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const { p, t } = row;
  const [why, setWhy] = useState("");
  const [touched, setTouched] = useState(false);
  /* รอบใหม่อยู่บนสุด คนตรวจจะได้เห็นของล่าสุดก่อนแล้วค่อยไล่ลงไปดูรอบก่อน */
  const subs = [...(t.subs ?? [])].reverse();
  const position = usePosition();
  const who = lastSub(t)?.by ?? t.whos[0] ?? "";
  /* GM เปิดดูสิ่งที่ส่งมาได้ แต่ PM เป็นคนตัดสินผลตรวจ */
  const ro = usePmReadOnly();

  return (
    <Sheet
      title={ro ? "งานที่ส่งมา" : "ตรวจงาน"}
      onClose={onClose}
      steady
      footer={
        ro ? (
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ปิด
          </button>
        ) : <>
          <button
            type="button"
            className="btn flex-1 justify-center !bg-destructive !text-white sm:flex-none"
            onClick={() => {
              setTouched(true);
              if (!why.trim()) return;
              sendBackWork(p.deal, t.name, why.trim(), bkkStamp());
              onDone();
            }}
          >
            ส่งกลับแก้
          </button>
          <button
            type="button"
            className="btn solid flex-1 justify-center !bg-[var(--success)] !text-white sm:flex-none"
            onClick={() => {
              approveWorkFlow(p.deal, t.name, bkkStamp());
              onDone();
            }}
          >
            ผ่าน
          </button>
        </>
      }
    >
      <Section title="งาน">
        <Row2 k="ชื่องาน" v={t.name} />
        <Row2 k="โปรเจค" v={projName(p)} />
        <Row2 k="ลูกค้า" v={p.cus} />
        <Row2 k="กำหนดส่ง" v={thaiDate(t.due)} />
      </Section>

      <Section title="ผู้ส่ง">
        <Row2 k="ชื่อ" v={memberName(who)} />
        <Row2 k="ตำแหน่ง" v={position(who) || "—"} />
      </Section>

      <section className="mt-4">
        <h3 className="mb-2 text-[13px] font-semibold">
          สิ่งที่ส่งมา{subs.length > 1 ? ` ${subs.length} ครั้ง` : ""}
        </h3>
        <ul className="flex flex-col gap-2">
          {subs.map((sb, i) => (
            <li
              key={`${sb.at}-${i}`}
              className="rounded-xl border border-border bg-card px-3.5 py-3"
            >
              <b className="block text-[13px] font-semibold">
                {sb.files.length ? sb.files.join(" · ") : "ไม่ได้แนบไฟล์"}
              </b>
              <em className="mt-1 block text-[12.5px] leading-relaxed text-muted-foreground not-italic">
                {sb.note || "ไม่ได้เขียนรายละเอียด"}
              </em>
              <em className="num mt-1 block text-[11.5px] text-muted-foreground not-italic">
                ส่งเมื่อ {thaiDate(sb.at.split(" ")[0])}
                {sb.at.split(" ")[1] ? ` ${sb.at.split(" ")[1]} น.` : ""}
                {i === 0 ? " · รอบล่าสุด" : " · รอบที่ตีกลับไปแล้ว"}
              </em>
            </li>
          ))}
          {subs.length === 0 && (
            <li className="py-3 text-[12.5px] text-muted-foreground">ไม่มีรายละเอียดที่ส่งมา</li>
          )}
        </ul>
      </section>

      {!ro && (
      <div className="mt-4">
        <Field
          label="สิ่งที่ต้องแก้"
          error={
            touched && !why.trim()
              ? "ส่งกลับให้แก้ต้องบอกว่าต้องแก้อะไร ผู้ทำงานจะได้รู้ว่าต้องทำอะไรต่อ"
              : undefined
          }
          hint="กรอกเฉพาะตอนส่งกลับแก้ · กดผ่านไม่ต้องกรอก"
        >
          <textarea
            value={why}
            onChange={(e) => {
              setWhy(e.target.value);
              if (touched) setTouched(false);
            }}
            placeholder="ถ้าส่งกลับให้แก้ ต้องบอกว่าต้องแก้อะไร"
            className="field-control h-[86px] resize-y py-2.5 leading-relaxed"
          />
        </Field>
      </div>
      )}
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Row2({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-muted-foreground">{k}</dt>
      <dd className="mt-[3px] text-[13.5px] font-medium break-words">{v}</dd>
    </div>
  );
}

