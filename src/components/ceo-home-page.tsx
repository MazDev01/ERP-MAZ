"use client";

/*
 * หน้าหลักบนมือถือของทุกบทบาท — หน้าตาอยู่ที่ mobile-home.tsx (ต้นแบบ mobile/home-glass.html)
 * ไฟล์นี้เหลือหน้าที่รวบรวมข้อมูล: เมนูของบทบาท เรื่องที่ต้องทำ และชื่อที่ใช้ทักทาย
 * จอกว้างกว่า 640px เด้งไปเมนูแรกของบทบาท (ต้นแบบ toDesktop) เพราะมีเมนูข้างอยู่แล้ว
 * แถบล่างสามช่อง (หน้าหลัก / บัญชีของฉัน / แจ้งเตือน) และแผ่นเมนูบัญชีมาจากเปลือกแอป (app-shell)
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { mobileHomeOf, navItemsOf, useMenuAccess } from "@/lib/nav";
import { useMyEmpType } from "@/lib/leave-policy";
import { useMyRoles } from "@/lib/hr-link";
import { useHydrated } from "@/lib/pwa";
import { useProfile } from "@/lib/profile-data";
import { approvers, useApprovalRoute, useRole } from "@/lib/role";
import { useNotices } from "./notification-menu";
import { MobileHome } from "./mobile-home";

export function CeoHomePage() {
  return <RoleHomePage />;
}

/*
 * /home — หน้าหลักการ์ดเมนูของบทบาทที่ไม่มีหน้าหลักเป็นของตัวเอง
 * พนักงานกับ CEO มีหน้าหลักของตัวเอง (my-home · ceo-home) เปิด /home แล้วพาไปหน้านั้นแทน
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
     (เดิมตัดโอทีกับสลิปเงินเดือนของพนักงานออกตามต้นแบบ my-home.html ที่มีแค่ห้าการ์ด
      แต่ต้นแบบนั้นไม่มีสองเมนูนี้ในเมนูข้างด้วย พอระบบจริงมี คนที่ใช้แต่มือถือจึงหาสลิปของตัวเองไม่เจอ) */
  /* ประเภทการจ้างตัดเมนู "ของฉัน" เหมือนแถบซ้าย (เจ้าของสั่ง 30 ก.ย. 2569) */
  const menu = navItemsOf(roles, access, route, useMyEmpType());
  /* การ์ดหน้าหลัก (มือถือ) รวม "ผู้สนใจ" กับ "ใบเสนอราคา" เป็นการ์ดเดียว (ยกมาจากระบบต้นฉบับ)
     จอคอมยังใช้สองเมนูเดิมในแถบข้าง — รวมเฉพาะเมื่อเห็นทั้งสองเมนู (ผู้ดูแลอาจปิดเมนูใดเมนูหนึ่งไว้) */
  const items = useMemo(() => {
    const lead = menu.find((i) => i.href === "/leads");
    if (!lead || !menu.some((i) => i.href === "/quotations")) return menu;
    return menu
      .filter((i) => i.href !== "/quotations")
      .map((i) =>
        i === lead ? { ...i, label: "ผู้สนใจและใบเสนอราคา", icon: "quotation" as const, href: "/leads-quotes" } : i,
      );
  }, [menu]);
  const notices = useNotices();
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

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 640px)");
    const go = () => {
      if (!phone.matches) router.replace(first);
    };
    go();
    phone.addEventListener("change", go);
    return () => phone.removeEventListener("change", go);
  }, [router, first]);

  /* หน้าหลักบนมือถือใช้ดีไซน์ใหม่ทั้งหน้า (ต้นแบบ mobile/home-glass.html 30 ก.ย. 2569)
     จอกว้างไม่ได้ใช้หน้านี้ — เด้งไปเมนูแรกของบทบาทตั้งแต่ useEffect ด้านบนแล้ว */
  return <MobileHome items={items} notices={notices} hello={hello} />;
}
