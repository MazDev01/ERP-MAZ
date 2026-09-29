"use client";

/*
 * หน้าหลักของ CEO (ต้นแบบ dose-erp-maz/ceo-home.html) — มีไว้สำหรับมือถือเท่านั้น
 * คำทักทาย + ภาพประกอบ (mh-art) + การ์ดเมนูตามเมนูข้างของ CEO
 * จอกว้างกว่า 640px เด้งไปเมนูแรกของบทบาท (ต้นแบบ toDesktop) เพราะมีเมนูข้างอยู่แล้ว
 * แถบล่างสามช่อง (หน้าหลัก / บัญชีของฉัน / แจ้งเตือน) และแผ่นเมนูบัญชีมาจากเปลือกแอป (app-shell)
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { mobileHomeOf, navItemsOf, useMenuAccess } from "@/lib/nav";
import { useMyRoles } from "@/lib/hr-link";
import { useHydrated } from "@/lib/pwa";
import { useProfile } from "@/lib/profile-data";
import { useProfilePhoto } from "@/lib/profile-store";
import { approvers, roleLabel, useApprovalRoute, useRole } from "@/lib/role";
import Image from "next/image";
import { bkkNow, greetNow, thaiDate, todayIso } from "@/lib/format";
import { ICONS } from "./app-shell";
import { HomeIcon, SearchIcon } from "./icons";
import { NotificationMenu } from "./notification-menu";

export function CeoHomePage() {
  return <RoleHomePage />;
}

/*
 * /home — หน้าหลักการ์ดเมนูของบทบาทที่ไม่มีหน้าหลักเป็นของตัวเอง
 * ทีมงานกับ CEO มีหน้าหลักของตัวเอง (my-home · ceo-home) เปิด /home แล้วพาไปหน้านั้นแทน
 * ไม่งั้นลิงก์เก่าหรือที่อยู่ที่พิมพ์เองจะไปจบที่หน้า "ไม่ได้อยู่ในเมนู"
 */
export function HomePage() {
  const router = useRouter();
  const role = useRole();
  const hydrated = useHydrated();
  /* บทบาทอ่านจาก localStorage — ย้ายหลัง hydrate เท่านั้น ไม่งั้นเด้งตามค่าเริ่มต้นฝั่งเซิร์ฟเวอร์ */
  const mine = mobileHomeOf(role);
  useEffect(() => {
    if (hydrated && mine !== "/home") router.replace(mine);
  }, [hydrated, mine, router]);
  return <RoleHomePage />;
}

/*
 * หน้าหลักการ์ดเมนูบนมือถือของทุกบทบาท (ผู้ใช้สั่ง 22 ก.ย. 2569 ให้ทุกบทบาทเป็นแบบหน้าหลัก CEO)
 * การ์ดสร้างจากเมนูข้างของบทบาท จึงตรงกับเมนูเสมอ รวมกลุ่ม "ของฉัน" ด้วย
 */
export function RoleHomePage() {
  const router = useRouter();
  const role = useRole();
  const roles = useMyRoles();
  const access = useMenuAccess();
  const route = useApprovalRoute();
  const me = useProfile();
  /* การ์ดตรงกับเมนูข้างเสมอ ไม่กรองทิ้งรายการไหน — มือถือกับจอกว้างจะได้เห็นหน้าชุดเดียวกัน
     (เดิมตัดโอทีกับสลิปเงินเดือนของทีมงานออกตามต้นแบบ my-home.html ที่มีแค่ห้าการ์ด
      แต่ต้นแบบนั้นไม่มีสองเมนูนี้ในเมนูข้างด้วย พอระบบจริงมี คนที่ใช้แต่มือถือจึงหาสลิปของตัวเองไม่เจอ) */
  const items = navItemsOf(roles, access, route);
  /* บนจอกว้างไปเมนูแรกที่เป็นงานของบทบาท — ข้ามหน้าตอกบัตรเพราะมีแถบข้างอยู่แล้ว */
  const first = items.find((i) => i.href !== "/")?.href ?? "/";
  /*
   * บทบาทผู้บริหารยังไม่มีชื่อจริงในทะเบียน เดิมจึงทักว่า "สวัสดี, CEO" ซึ่งอ่านเหมือนชื่อตำแหน่ง
   * ใช้ชื่อที่ผู้ดูแลตั้งไว้ในผู้อนุมัติระดับผู้บริหารก่อน ยังไม่ได้ตั้งค่อยใช้คำเรียกตำแหน่ง
   */
  const execName = approvers().exec.name.trim();
  const hello =
    role === "ceo"
      ? execName && execName !== "CEO"
        ? execName.split(" ")[0]
        : "ผู้บริหาร"
      : me.name.split(" ")[0];

  /* ชื่อย่อบนปุ่มโปรไฟล์ — ตัวแรกของชื่อกับของนามสกุล เหมือนที่ใช้ในเมนูผู้ใช้ */
  const initials = me.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  const photo = useProfilePhoto();
  /* วันนี้เป็นวันอะไร — อ่านผ่าน bkkNow() ตามกติกาเวลาของโปรเจค ไม่ใช่ new Date() ตรง ๆ */
  const now = bkkNow();
  const todayText = `วัน${TH_DAYS[now.getDay()]}ที่ ${thaiDate(todayIso())}`;
  /* คำค้นเมนู — ว่าง = เห็นทุกกลุ่มตามเดิม */
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const key = q.trim().toLowerCase();
    const hit = key ? items.filter((i) => i.label.toLowerCase().includes(key)) : items;
    const map = new Map<string, typeof items>();
    for (const i of hit) map.set(i.group, [...(map.get(i.group) ?? []), i]);
    return [...map.entries()];
  }, [items, q]);

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 640px)");
    const go = () => {
      if (!phone.matches) router.replace(first);
    };
    go();
    phone.addEventListener("change", go);
    return () => phone.removeEventListener("change", go);
  }, [router, first]);

  return (
    <div className="-mx-4 -mt-[18px] min-h-full bg-[#fbf5f4] px-4 pt-2 pb-6 sm:-mx-[30px] sm:bg-[#F6F7FA] sm:px-12 sm:pt-8">
      {/* แถบบนของหน้าหลัก — ชื่อย่อของเจ้าของเครื่องซ้าย ชื่อหน้าตรงกลาง กระดิ่งขวา
         หน้านี้ไม่มีแถบบนของเปลือกแอป (เป็นหน้าแรก ไม่มีที่ให้ย้อนกลับ) จึงทำแถบของตัวเอง */}
      <div className="flex min-w-0 items-center gap-3 sm:hidden">
        <Link
          href="/profile"
          aria-label="โปรไฟล์ของฉัน"
          className="size-11 flex-none overflow-hidden rounded-full bg-card shadow-[0_6px_16px_-10px_rgb(120_20_35/0.5)]"
        >
          {/* ตั้งรูปไว้แล้วใช้รูป ยังไม่ได้ตั้งใช้ตัวย่อชื่อ — อ่านจากสโตร์เดียวกับการ์ดโปรไฟล์ */}
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-[14px] font-bold text-primary">
              {initials}
            </span>
          )}
        </Link>
        <b className="min-w-0 flex-1 truncate text-center text-[18px] font-bold">หน้าหลัก</b>
        <NotificationMenu />
      </div>
      <div className="hidden justify-end sm:flex">
        <NotificationMenu />
      </div>

      <>
          {/* การ์ดทักทาย — ไล่สีแดงของแบรนด์ พร้อมวันที่วันนี้และบทบาทที่กำลังใช้อยู่
             ช่องค้นหาเกยขอบล่างของการ์ด ตามแบบที่เจ้าของส่งมา (25 ก.ย. 2569) */}
          <section className="relative mt-3 sm:mt-0">
            <div className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#8e0012_0%,#c00019_45%,#db0000_100%)] px-5 pt-5 pb-14 text-white sm:pb-6">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:repeating-linear-gradient(90deg,#fff_0_1px,transparent_1px_20px),repeating-linear-gradient(0deg,#fff_0_1px,transparent_1px_20px)]"
              />
              <span className="relative block">
                <Image src="/maz-logo.png" alt="MAZ" width={640} height={158} className="h-8 w-auto brightness-0 invert" priority />
                <b className="mt-3 block text-[21px] leading-tight font-bold">
                  {greetNow()}, {hello}
                </b>
                <em className="mt-1 block text-[12.5px] text-white/80 not-italic">{todayText}</em>
                <span className="mt-3 flex flex-wrap gap-2">
                  <em className="rounded-full bg-white/18 px-3 py-1 text-[12px] font-semibold not-italic">
                    {roleLabel(role)}
                  </em>
                  <em className="rounded-full border border-white/40 px-3 py-1 text-[12px] font-semibold not-italic">
                    ERP MAZ
                  </em>
                </span>
              </span>
            </div>
            {/* ค้นหาเมนู — เมนูของบางบทบาทมีสิบกว่ารายการ พิมพ์หาเร็วกว่าเลื่อนดูทีละกลุ่ม */}
            <label className="absolute inset-x-4 bottom-0 flex h-12 translate-y-1/2 items-center gap-2.5 rounded-[14px] bg-card px-4 shadow-[0_12px_28px_-14px_rgb(120_20_35/0.45)] sm:hidden">
              <SearchIcon className="size-[18px] flex-none text-muted-foreground" strokeWidth={2} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหาเมนู..."
                aria-label="ค้นหาเมนู"
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
              />
            </label>
          </section>
      </>



      {/* เมนูแบ่งตามกลุ่มเดียวกับเมนูข้าง — คนที่ชินกับจอคอมจะหาของเจอที่เดิม */}
      <div className="mt-11 sm:mt-7">
        {groups.length === 0 ? (
          <p className="glass rounded-[18px] px-4 py-8 text-center text-[13px] text-muted-foreground">
            ไม่พบเมนูที่ตรงกับ “{q}”
          </p>
        ) : (
          groups.map(([group, list]) => (
            <section key={group} className="mb-5">
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] font-bold">{group}</h3>
                <em className="num text-[12px] text-muted-foreground not-italic">{list.length} เมนู</em>
              </div>
              {/*
                มือถือ: ทุกกลุ่มเรียงเหมือนกันหมด สามช่องต่อแถว การ์ดขนาดเดียวกัน
                และคอลัมน์ตรงกันทุกกลุ่ม (เจ้าของสั่ง 25 ก.ย. 2569)
                เคยลองให้กลุ่มเล็กขยายเต็มแถวและจัดเศษไว้กลาง แล้วการ์ดโตไม่เท่ากันระหว่างกลุ่ม อ่านแล้วขัดตา
                จอกว้างยังเป็นกริดเติมเต็มความกว้างตามเดิม
              */}
              <ul
                className="flex list-none flex-wrap gap-2.5 p-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-[18px]"
                aria-label={group}
              >
                {list.map((i, n) => {
                  const Icon = ICONS[i.icon] ?? HomeIcon;
                  /* ทุกกลุ่มใช้การ์ดขนาดเดียวกันหมด (สามช่องต่อแถว) แถวไหนไม่เต็มจัดกลาง
                     ถ้าให้กลุ่มเล็กขยายเต็มแถว การ์ดจะโตไม่เท่ากันระหว่างกลุ่ม อ่านแล้วขัดตา */
                  const cols = 3;
                  return (
                    <li
                      key={i.href}
                      className="min-w-0"
                      style={{ flexBasis: `calc((100% - ${(cols - 1) * 10}px) / ${cols})` }}
                    >
                      <Link
                        href={i.href}
                        className="group flex h-full w-full flex-col items-center justify-start gap-2 rounded-[18px] bg-white p-2.5 text-center text-foreground shadow-[0_1px_2px_rgb(120_20_35/0.05),0_12px_28px_-20px_rgb(120_20_35/0.35)] transition-shadow hover:shadow-[0_14px_30px_-14px_rgba(30,40,70,.36),0_0_0_1.5px_var(--primary)] active:bg-primary active:text-white sm:aspect-square sm:justify-center sm:gap-3 sm:rounded-2xl sm:p-3.5 sm:shadow-[0_10px_26px_-14px_rgba(30,40,70,.28),0_1px_0_rgba(30,40,70,.04)]"
                      >
                        <span
                          className={`grid size-[42px] flex-none place-items-center rounded-[13px] transition-colors group-active:bg-white/20 group-active:text-white md:size-12 md:!bg-transparent md:!text-inherit ${TILE_TONE[n % TILE_TONE.length]}`}
                        >
                          <Icon className="size-[22px] flex-none md:size-12" strokeWidth={1.8} />
                        </span>
                        <span className="text-[11.5px] leading-[1.3] font-semibold sm:text-[15px]">
                          {i.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** ชื่อวันภาษาไทย — ใช้ในบรรทัดวันที่ของการ์ดทักทาย */
const TH_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

/*
 * สีแผ่นไอคอนบนมือถือ — วนตามลำดับเมนู ให้แต่ละช่องแยกจากกันด้วยสายตา ไม่ใช่ขาวล้วนทั้งหน้า
 * ใช้โทนชุดเดียวกับที่หน้าลงเวลาใช้อยู่ ไม่ได้ตั้งสีใหม่เฉพาะหน้านี้
 */
const TILE_TONE = [
  "bg-[var(--accent)] text-primary",
  "bg-[var(--info-soft)] text-[var(--info)]",
  "bg-[var(--success-soft)] text-[var(--success)]",
  "bg-[var(--warning-soft)] text-[var(--warning)]",
];

