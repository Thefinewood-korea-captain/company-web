// 더조은목재 문의 게시판 API (Cloudflare Pages Function)
// 저장소: Workers KV — Pages 프로젝트 설정에서 변수 이름 INQUIRIES로 바인딩
// 관리자 인증: 환경변수 ADMIN_KEY (Secret) — ERP 문의관리 화면이 이 값을 보내야 조회/상태변경 가능
// 분류는 3가지로 고정: 상품문의 · 도면상담 · 고객지원
// 상태는 4단계로 고정: 신규 → 연락중 → 견적발송 → 완료

const CATEGORIES = ["상품문의", "도면상담", "고객지원"];
const STATUSES = ["신규", "연락중", "견적발송", "완료"];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() },
  });
}

function checkAdmin(request, env) {
  const url = new URL(request.url);
  const key = request.headers.get("X-Admin-Key") || url.searchParams.get("key") || "";
  return !!env.ADMIN_KEY && key === env.ADMIN_KEY;
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors() });
}

// 손님이 홈페이지에서 문의를 접수할 때 (인증 불필요 — 아무나 접수 가능해야 함)
export async function onRequestPost({ request, env }) {
  if (!env.INQUIRIES) return json({ error: "저장소가 연결되지 않았습니다(INQUIRIES 바인딩 필요)" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "잘못된 요청입니다" }, 400);
  }

  // 벌레잡이(허니팟): 화면에는 안 보이지만 자동입력 로봇은 채우는 칸. 채워져 있으면 조용히 접수된 것처럼만 응답.
  if (body.website) return json({ ok: true });

  const category = String(body.category || "").trim();
  if (!CATEGORIES.includes(category)) return json({ error: "문의 분류를 선택해 주세요" }, 400);

  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const message = String(body.message || "").trim();
  if (!name || !phone || !message) return json({ error: "이름·연락처·문의 내용을 입력해 주세요" }, 400);
  if (!body.agree) return json({ error: "개인정보 수집·이용에 동의해 주세요" }, 400);

  const now = new Date();
  const id = now.toISOString().replace(/[^0-9]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 8);
  const record = {
    id,
    category,
    name: name.slice(0, 60),
    phone: phone.slice(0, 40),
    company: String(body.company || "").trim().slice(0, 80),
    title: String(body.title || "").trim().slice(0, 100) || category,
    message: message.slice(0, 2000),
    status: "신규",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  await env.INQUIRIES.put(`inq:${id}`, JSON.stringify(record));
  return json({ ok: true, id });
}

// ERP 문의관리 화면이 전체 목록을 받아갈 때 (관리자 키 필요)
export async function onRequestGet({ request, env }) {
  if (!env.INQUIRIES) return json({ error: "저장소가 연결되지 않았습니다(INQUIRIES 바인딩 필요)" }, 500);
  if (!checkAdmin(request, env)) return json({ error: "인증이 필요합니다" }, 401);

  const list = await env.INQUIRIES.list({ prefix: "inq:" });
  const items = [];
  for (const k of list.keys) {
    const v = await env.INQUIRIES.get(k.name);
    if (v) items.push(JSON.parse(v));
  }
  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return json({ ok: true, items });
}

// ERP에서 문의 상태를 바꿀 때 (관리자 키 필요)
export async function onRequestPatch({ request, env }) {
  if (!env.INQUIRIES) return json({ error: "저장소가 연결되지 않았습니다(INQUIRIES 바인딩 필요)" }, 500);
  if (!checkAdmin(request, env)) return json({ error: "인증이 필요합니다" }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "잘못된 요청입니다" }, 400);
  }
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id || !STATUSES.includes(status)) return json({ error: "잘못된 값입니다" }, 400);

  const raw = await env.INQUIRIES.get(`inq:${id}`);
  if (!raw) return json({ error: "해당 문의를 찾을 수 없습니다" }, 404);

  const record = JSON.parse(raw);
  record.status = status;
  record.updatedAt = new Date().toISOString();
  await env.INQUIRIES.put(`inq:${id}`, JSON.stringify(record));
  return json({ ok: true });
}
