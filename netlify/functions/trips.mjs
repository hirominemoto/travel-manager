// 旅のデータを保存・読み出しする窓口。合言葉（TABI_PASSWORD）がないと使えない。
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const digest = (text) => createHash("sha256").update(String(text ?? "")).digest();

function passOk(req) {
  const expected = process.env.TABI_PASSWORD;
  if (!expected) return null; // 未設定
  const given = req.headers.get("x-tabi-pass") || "";
  return timingSafeEqual(digest(given), digest(expected));
}

const validId = (id) => typeof id === "string" && /^[a-z0-9-]{6,40}$/.test(id);

export default async (req) => {
  const ok = passOk(req);
  if (ok === null) return json(500, { error: "Netlifyで合言葉（TABI_PASSWORD）が設定されていません" });
  if (!ok) return json(401, { error: "合言葉がちがいます" });

  const store = getStore({ name: "trips", consistency: "strong" });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET" && !id) {
    const { blobs } = await store.list();
    const trips = [];
    for (const b of blobs) {
      const t = await store.get(b.key, { type: "json" });
      if (t) trips.push({ id: t.id, name: t.name, start: t.start, end: t.end, updatedAt: t.updatedAt, count: (t.items || []).length });
    }
    trips.sort((a, b) => String(b.start).localeCompare(String(a.start)));
    return json(200, { trips });
  }

  if (!validId(id)) return json(400, { error: "旅のIDがおかしいです" });

  if (req.method === "GET") {
    const t = await store.get(id, { type: "json" });
    return t ? json(200, { trip: t }) : json(404, { error: "旅が見つかりません" });
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "データが読めません" });
    }
    const trip = body?.trip;
    if (!trip || trip.id !== id) return json(400, { error: "データがおかしいです" });
    const current = await store.get(id, { type: "json" });
    // 別の端末で先に保存されていたら、上書きせずに知らせる
    if (current && body.baseUpdatedAt && current.updatedAt !== body.baseUpdatedAt) {
      return json(409, { error: "別の端末で更新されています", trip: current });
    }
    trip.updatedAt = new Date().toISOString();
    await store.setJSON(id, trip);
    return json(200, { trip });
  }

  if (req.method === "DELETE") {
    await store.delete(id);
    return json(200, { ok: true });
  }

  return json(405, { error: "使えない操作です" });
};

export const config = { path: "/api/trips" };
