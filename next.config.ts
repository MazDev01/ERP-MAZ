import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // เปิดผ่าน IP เครือข่ายได้ (HMR ไม่ถูกบล็อก) ตอน dev
  allowedDevOrigins: ["26.224.66.120"],

  /*
   * ป้ายวงกลมดำของ Next ตอน dev อยู่มุมซ้ายล่าง ไปทับช่องแรกของแถบเมนูล่างบนมือถือพอดี
   * (เจ้าของแจ้ง 8 ต.ค. 2569 — เข้าใจว่าหน้าจอเพี้ยน) ปิดทิ้งไปเลย ข้อผิดพลาดยังเด้งเตือนตามปกติ
   * ของจริงที่ build แล้วไม่มีป้ายนี้อยู่แล้ว
   */
  devIndicators: false,

  async headers() {
    return [
      {
        /*
         * ส่วนหัวความปลอดภัยของทุกหน้า (ตรวจความปลอดภัย 5 ต.ค. 2569 · SEC-02)
         * เดิมไม่ส่งอะไรเลย เว็บอื่นจึงเอาหน้าเราไปซ้อนใน iframe หลอกให้กดได้ (clickjacking)
         *
         * CSP: ยอม 'unsafe-inline'/'unsafe-eval' กับสคริปต์ เพราะ Next ฝังสคริปต์เริ่มต้นไว้ในหน้า
         *      รูปต้องรับ data: กับ blob: เพราะรูปโปรไฟล์เก็บเป็น data URL และไฟล์โปรเจคเปิดผ่าน blob
         * Permissions-Policy: เปิด geolocation ให้เว็บเราเองเท่านั้น (หน้าลงเวลาต้องใช้พิกัด)
         *      กล้องเปิดให้ด้วยเพราะถ่ายรูปแนบใบเบิกและรูปโปรไฟล์บนมือถือ
         * HSTS มีผลเฉพาะตอนเสิร์ฟผ่าน https ของจริง บน localhost เบราว์เซอร์จะข้ามให้เอง
         */
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              /* แผนที่จุดลงเวลาใช้ภาพ tile ของ OpenStreetMap — ไม่อนุญาตไว้ แผนที่จะขึ้นเป็นรูปแตก */
              "img-src 'self' data: blob: https://tile.openstreetmap.org",
              "font-src 'self' data:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      {
        /* service worker ต้องไม่ถูกแคช ไม่งั้นตัวเก่าจะค้างอยู่หลัง deploy
           และต้องเสิร์ฟจากรากเว็บถึงจะคุมได้ทั้งไซต์ */
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
