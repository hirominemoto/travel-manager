"use strict";

const TYPES = [
  { key: "move", label: "移動", color: "var(--move)" },
  { key: "stay", label: "宿", color: "var(--stay)" },
  { key: "food", label: "食事", color: "var(--food)" },
  { key: "sight", label: "観光・見どころ", color: "var(--sight)" },
  { key: "shop", label: "買い物・おみやげ", color: "var(--shop)" },
  { key: "other", label: "その他", color: "var(--other)" },
];
const typeOf = (key) => TYPES.find((t) => t.key === key) || TYPES[TYPES.length - 1];
const PASS_KEY = "tabi-pass";
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

const app = document.getElementById("app");
let trip = null; // いま開いている旅
let editingItemId = null;

// ---------- 小道具 ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = (n) => "¥" + Math.round(Number(n) || 0).toLocaleString("ja-JP");
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

function parseDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function dateLabel(iso, withYear = true) {
  if (!iso) return "日付なし";
  const d = parseDate(iso);
  if (isNaN(d)) return iso;
  return `${withYear ? d.getFullYear() + "年" : ""}${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
}
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function tripDays(t) {
  const days = new Set();
  if (t.start && t.end) {
    const d = parseDate(t.start);
    const end = parseDate(t.end);
    for (let i = 0; d <= end && i < 60; i++) {
      days.add(isoOf(d));
      d.setDate(d.getDate() + 1);
    }
  }
  t.items.forEach((it) => days.add(it.date || ""));
  return [...days].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (isErr ? " err" : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isErr ? 4000 : 1600);
}

// ---------- サーバーとのやりとり ----------
async function api(method, id, body) {
  const url = "/api/trips" + (id ? "?id=" + encodeURIComponent(id) : "");
  const res = await fetch(url, {
    method,
    headers: { "x-tabi-pass": localStorage.getItem(PASS_KEY) || "", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem(PASS_KEY);
    renderLogin("合言葉がちがうようです。もう一度入れてください");
    throw new Error("unauthorized");
  }
  if (res.status === 409) {
    const err = new Error("conflict");
    err.trip = data.trip;
    throw err;
  }
  if (!res.ok) throw new Error(data.error || "通信に失敗しました");
  return data;
}

let saving = Promise.resolve();
function save() {
  const snapshot = JSON.parse(JSON.stringify(trip));
  saving = saving.then(async () => {
    try {
      const { trip: saved } = await api("PUT", snapshot.id, { trip: snapshot, baseUpdatedAt: snapshot.updatedAt || null });
      if (trip && trip.id === saved.id) trip.updatedAt = saved.updatedAt;
      toast("保存しました");
    } catch (e) {
      if (e.message === "unauthorized") return;
      if (e.message === "conflict" && e.trip) {
        trip = e.trip;
        renderTrip();
        toast("別の端末で更新されていたので、最新の内容を読み込みました。もう一度直してください", true);
        return;
      }
      toast("保存できませんでした：" + e.message, true);
    }
  });
  return saving;
}

// ---------- 合計の計算 ----------
const EXTRA_COLOR = "#c07aa8";
function totals(t) {
  const sum = (arr) => arr.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const extras = t.extras || [];
  const live = t.items.filter((it) => !it.skipped).concat(extras);
  const byType = TYPES.map((ty) => ({ ...ty, amount: sum(t.items.filter((it) => !it.skipped && typeOf(it.type).key === ty.key)) }));
  byType.push({ key: "extra", label: "その他の旅費", color: EXTRA_COLOR, amount: sum(extras) });
  return { total: sum(live), paid: sum(live.filter((it) => it.paid)), byType: byType.filter((x) => x.amount > 0), sum, extraTotal: sum(extras) };
}

// ---------- 並び順 ----------
// 時刻のある行程を時刻順に入れる。時刻のない行程は今の位置のまま
function placeByTime(item) {
  const others = trip.items.filter((it) => it.id !== item.id);
  if (!item.time) {
    trip.items = others.concat(item);
    return;
  }
  // 同じ日で、時刻が同じか前の行程のすぐうしろに入れる
  let idx = -1;
  others.forEach((it, i) => { if (it.date === item.date && it.time && it.time <= item.time) idx = i + 1; });
  if (idx === -1) idx = others.findIndex((it) => it.date === item.date);
  if (idx === -1) {
    // その日がまだ空なら、日付順で前の日の最後のうしろ
    let last = -1;
    others.forEach((it, i) => { if (it.date <= item.date) last = i; });
    idx = last + 1;
  }
  others.splice(idx, 0, item);
  trip.items = others;
}

function moveItem(id, dir) {
  const items = trip.items;
  const i = items.findIndex((it) => it.id === id);
  const day = items[i].date;
  let j = i + dir;
  while (j >= 0 && j < items.length && items[j].date !== day) j += dir;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  renderTrip();
  save();
}

function sortDayByTime(day) {
  // 時刻のない行程は、直前の時刻ありの行程にくっつけたまま動かす
  const dayItems = trip.items.filter((it) => it.date === day);
  const groups = [];
  let cur = { key: "", items: [] };
  dayItems.forEach((it) => {
    if (it.time) {
      if (cur.items.length) groups.push(cur);
      cur = { key: it.time, items: [it] };
    } else cur.items.push(it);
  });
  if (cur.items.length) groups.push(cur);
  groups.sort((a, b) => a.key.localeCompare(b.key));
  const sorted = groups.flatMap((g) => g.items);
  let k = 0;
  trip.items = trip.items.map((it) => (it.date === day ? sorted[k++] : it));
  renderTrip();
  save();
}

// ---------- 画面：ログイン ----------
function renderLogin(message = "") {
  app.innerHTML = `
    <div class="login card">
      <h1>旅のしおり</h1>
      <p class="sub">${esc(message || "合言葉を入れてください。この端末で一度入れれば、次からは聞かれません。")}</p>
      <form id="loginForm">
        <label>合言葉<input name="pass" type="password" autocomplete="current-password" required></label>
        <button class="primary" type="submit">はじめる</button>
      </form>
    </div>`;
  document.getElementById("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    localStorage.setItem(PASS_KEY, e.target.pass.value);
    route();
  };
}

// ---------- 画面：旅の一覧 ----------
async function renderList() {
  app.innerHTML = `<h1>旅のしおり</h1><p class="sub">行程・時刻・費用をまとめて、合計まで出るプランノート</p><p class="muted">読み込み中…</p>`;
  let trips;
  try {
    ({ trips } = await api("GET"));
  } catch (e) {
    if (e.message !== "unauthorized") app.innerHTML += `<p class="muted">読み込めませんでした：${esc(e.message)}</p>`;
    return;
  }
  app.innerHTML = `
    <h1>旅のしおり</h1>
    <p class="sub">行程・時刻・費用をまとめて、合計まで出るプランノート</p>
    <div class="toolbar">
      <button class="primary" id="newTrip">＋ 新しい旅</button>
      <span class="spacer"></span>
      <button class="ghost small" id="seedTrip">お試しの旅を入れる</button>
    </div>
    ${trips.length ? "" : `<p class="muted">まだ旅がありません。「新しい旅」から作るか、「お試しの旅を入れる」で奈良井宿の旅を入れて触ってみてください。</p>`}
    ${trips.map((t) => `
      <div class="card trip-link" data-id="${esc(t.id)}">
        <div><b>${esc(t.name)}</b><div class="muted">${esc(dateLabel(t.start))} 〜 ${esc(dateLabel(t.end, false))}</div></div>
        <div class="muted">${t.count}件の行程</div>
      </div>`).join("")}`;
  document.getElementById("newTrip").onclick = () => openTripDialog(null);
  document.getElementById("seedTrip").onclick = async () => {
    const s = window.SEED_TRIP;
    trip = { id: uid(), name: s.name, start: s.start, end: s.end, memo: s.memo, items: s.items.map((it) => ({ id: uid(), skipped: false, ...it })), updatedAt: null };
    await save();
    location.hash = "#/trip/" + trip.id;
  };
  app.querySelectorAll(".trip-link").forEach((el) => (el.onclick = () => (location.hash = "#/trip/" + el.dataset.id)));
}

// ---------- 画面：旅の中身 ----------
async function loadTrip(id) {
  if (trip && trip.id === id) return renderTrip();
  app.innerHTML = `<p class="muted">読み込み中…</p>`;
  try {
    ({ trip } = await api("GET", id));
    trip.items = trip.items || [];
    renderTrip();
  } catch (e) {
    if (e.message !== "unauthorized") app.innerHTML = `<p>読み込めませんでした：${esc(e.message)}</p><p><a href="#/">一覧へもどる</a></p>`;
  }
}

function itemHtml(it) {
  const ty = typeOf(it.type);
  const amount = Number(it.amount) || 0;
  const status = amount > 0 ? (it.paid ? `<span class="paid">支払い済み</span>` : `<span class="unpaid">未払い</span>`) : "";
  return `
    <div class="item${it.skipped ? " skipped" : ""}" data-id="${esc(it.id)}">
      <div class="time">${it.time ? esc(it.time) : "—"}${it.endTime ? `<small>〜${esc(it.endTime)}</small>` : ""}</div>
      <div>
        <div class="title"><i class="dot" style="background:${ty.color}"></i><span>${esc(it.title)}</span></div>
        <div class="meta">${esc(ty.label)}${status ? " ・ " + status : ""}</div>
      </div>
      <div class="amount">${amount > 0 ? yen(amount) : ""}</div>
      ${it.memo ? `<div class="note">${esc(it.memo)}</div>` : ""}
      <div class="move no-print"><button type="button" data-move="-1" aria-label="上へ">↑</button><button type="button" data-move="1" aria-label="下へ">↓</button></div>
    </div>`;
}

function renderTrip() {
  const t = trip;
  t.extras = t.extras || [];
  const { total, paid, byType, sum, extraTotal } = totals(t);
  const days = tripDays(t);
  app.innerHTML = `
    <div class="toolbar no-print">
      <button class="ghost small" id="back">← 一覧</button>
      <span class="spacer"></span>
      <button class="small" id="editTrip">旅の情報</button>
      <button class="small" id="print">印刷・PDF</button>
    </div>
    <div class="card">
      <div class="summary">
        <div><h1 style="margin:0">${esc(t.name)}</h1><div class="muted">${esc(dateLabel(t.start))} 〜 ${esc(dateLabel(t.end, false))}</div></div>
        <div class="total">${yen(total)}</div>
        <div class="muted">支払い済み ${yen(paid)}</div>
        <div class="rest">残り ${yen(total - paid)}</div>
      </div>
      ${t.memo ? `<div class="memo">${esc(t.memo)}</div>` : ""}
    </div>
    ${days.map((day) => {
      const items = t.items.filter((it) => (it.date || "") === day);
      const sub = sum(items.filter((it) => !it.skipped));
      return `
        <div class="day"><h3>${esc(dateLabel(day))}</h3><span class="subtotal">小計 ${yen(sub)}</span></div>
        ${items.map(itemHtml).join("") || `<p class="muted">まだ行程がありません</p>`}
        <div class="toolbar add-day no-print">
          <button class="small" data-add="${esc(day)}">＋ 行程を足す</button>
          ${items.length > 1 ? `<button class="small ghost" data-sort="${esc(day)}">時刻順に並べ直す</button>` : ""}
        </div>`;
    }).join("")}
    <div class="day"><h3>その他の旅費</h3><span class="subtotal">小計 ${yen(extraTotal)}</span></div>
    ${t.extras.map((x) => `
      <div class="item extra" data-extra="${esc(x.id)}">
        <div class="time">—</div>
        <div>
          <div class="title"><i class="dot" style="background:${EXTRA_COLOR}"></i><span>${esc(x.title)}</span></div>
          <div class="meta">${(Number(x.amount) || 0) > 0 ? (x.paid ? `<span class="paid">支払い済み</span>` : `<span class="unpaid">未払い</span>`) : ""}</div>
        </div>
        <div class="amount">${(Number(x.amount) || 0) > 0 ? yen(x.amount) : ""}</div>
        ${x.memo ? `<div class="note">${esc(x.memo)}</div>` : ""}
      </div>`).join("") || `<p class="muted">食事代やグリーン車など、行程に入れない費用をここに足せます</p>`}
    <div class="toolbar add-day no-print"><button class="small" id="addExtra">＋ その他の旅費を足す</button></div>
    ${byType.length ? `<div class="card breakdown" style="margin-top:22px"><h2>種類ごとの内訳</h2>${byType.map((x) => `<div><span><i class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${x.color};margin-right:6px"></i>${esc(x.label)}</span><b>${yen(x.amount)}</b></div>`).join("")}</div>` : ""}`;

  document.getElementById("back").onclick = () => (location.hash = "#/");
  document.getElementById("editTrip").onclick = () => openTripDialog(trip);
  document.getElementById("print").onclick = () => window.print();
  app.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => openItemDialog(null, b.dataset.add)));
  app.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => sortDayByTime(b.dataset.sort)));
  document.getElementById("addExtra").onclick = () => openExtraDialog(null);
  app.querySelectorAll("[data-extra]").forEach((el) => (el.onclick = () => openExtraDialog(el.dataset.extra)));
  app.querySelectorAll(".item:not(.extra)").forEach((el) => {
    el.onclick = (e) => {
      const mv = e.target.closest("[data-move]");
      if (mv) {
        e.stopPropagation();
        moveItem(el.dataset.id, Number(mv.dataset.move));
        return;
      }
      openItemDialog(el.dataset.id);
    };
  });
}

// ---------- 行程の編集 ----------
const itemDialog = document.getElementById("itemDialog");
const itemForm = document.getElementById("itemForm");

function openItemDialog(id, day) {
  editingItemId = id;
  const it = id ? trip.items.find((x) => x.id === id) : { date: day || trip.start, type: "move", title: "", time: "", endTime: "", amount: "", paid: false, skipped: false, memo: "" };
  document.getElementById("itemDialogTitle").textContent = id ? "行程を直す" : "行程を足す";
  const days = tripDays(trip).filter(Boolean);
  if (it.date && !days.includes(it.date)) days.push(it.date);
  itemForm.date.innerHTML = days.map((d) => `<option value="${esc(d)}">${esc(dateLabel(d, false))}</option>`).join("");
  itemForm.type.innerHTML = TYPES.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join("");
  itemForm.title.value = it.title || "";
  itemForm.date.value = it.date || days[0] || "";
  itemForm.type.value = typeOf(it.type).key;
  itemForm.time.value = it.time || "";
  itemForm.endTime.value = it.endTime || "";
  itemForm.amount.value = it.amount ? it.amount : "";
  itemForm.paid.checked = !!it.paid;
  itemForm.skipped.checked = !!it.skipped;
  itemForm.memo.value = it.memo || "";
  document.getElementById("itemDelete").hidden = !id;
  itemDialog.showModal();
}

itemForm.onsubmit = (e) => {
  e.preventDefault();
  const f = itemForm;
  const data = {
    title: f.title.value.trim(),
    date: f.date.value,
    type: f.type.value,
    time: f.time.value,
    endTime: f.endTime.value,
    amount: Math.max(0, Math.round(Number(f.amount.value) || 0)),
    paid: f.paid.checked,
    skipped: f.skipped.checked,
    memo: f.memo.value.trim(),
  };
  if (!data.title) return;
  if (editingItemId) {
    const it = trip.items.find((x) => x.id === editingItemId);
    const moved = it.time !== data.time || it.date !== data.date;
    Object.assign(it, data);
    if (moved) placeByTime(it);
  } else {
    const it = { id: uid(), ...data };
    if (data.time) placeByTime(it);
    else {
      // 時刻なし：その日の最後に足す
      let last = -1;
      trip.items.forEach((x, i) => { if (x.date <= data.date) last = i; });
      trip.items.splice(last + 1, 0, it);
    }
  }
  itemDialog.close();
  renderTrip();
  save();
};
document.getElementById("itemCancel").onclick = () => itemDialog.close();
document.getElementById("itemDelete").onclick = () => {
  if (!confirm("この行程を削除しますか？（「行かなかった」にすれば、消さずに残せます）")) return;
  trip.items = trip.items.filter((x) => x.id !== editingItemId);
  itemDialog.close();
  renderTrip();
  save();
};

// ---------- その他の旅費の編集 ----------
const extraDialog = document.getElementById("extraDialog");
const extraForm = document.getElementById("extraForm");
let editingExtraId = null;

function openExtraDialog(id) {
  editingExtraId = id;
  const x = id ? trip.extras.find((e) => e.id === id) : { title: "", amount: "", paid: false, memo: "" };
  document.getElementById("extraDialogTitle").textContent = id ? "その他の旅費を直す" : "その他の旅費を足す";
  extraForm.title.value = x.title || "";
  extraForm.amount.value = x.amount ? x.amount : "";
  extraForm.paid.checked = !!x.paid;
  extraForm.memo.value = x.memo || "";
  document.getElementById("extraDelete").hidden = !id;
  extraDialog.showModal();
}

extraForm.onsubmit = (e) => {
  e.preventDefault();
  const data = {
    title: extraForm.title.value.trim(),
    amount: Math.max(0, Math.round(Number(extraForm.amount.value) || 0)),
    paid: extraForm.paid.checked,
    memo: extraForm.memo.value.trim(),
  };
  if (!data.title) return;
  if (editingExtraId) Object.assign(trip.extras.find((x) => x.id === editingExtraId), data);
  else trip.extras.push({ id: uid(), ...data });
  extraDialog.close();
  renderTrip();
  save();
};
document.getElementById("extraCancel").onclick = () => extraDialog.close();
document.getElementById("extraDelete").onclick = () => {
  if (!confirm("この費用を削除しますか？")) return;
  trip.extras = trip.extras.filter((x) => x.id !== editingExtraId);
  extraDialog.close();
  renderTrip();
  save();
};

// ---------- 旅の情報の編集 ----------
const tripDialog = document.getElementById("tripDialog");
const tripForm = document.getElementById("tripForm");
let tripDialogTarget = null;

function openTripDialog(t) {
  tripDialogTarget = t;
  document.getElementById("tripDialogTitle").textContent = t ? "旅の情報" : "新しい旅";
  tripForm.name.value = t?.name || "";
  tripForm.start.value = t?.start || "";
  tripForm.end.value = t?.end || "";
  tripForm.memo.value = t?.memo || "";
  document.getElementById("tripDelete").hidden = !t;
  tripDialog.showModal();
}

tripForm.onsubmit = async (e) => {
  e.preventDefault();
  let start = tripForm.start.value;
  let end = tripForm.end.value;
  if (end < start) [start, end] = [end, start];
  const data = { name: tripForm.name.value.trim(), start, end, memo: tripForm.memo.value.trim() };
  tripDialog.close();
  if (tripDialogTarget) {
    Object.assign(trip, data);
    renderTrip();
    save();
  } else {
    trip = { id: uid(), ...data, items: [], updatedAt: null };
    await save();
    location.hash = "#/trip/" + trip.id;
  }
};
document.getElementById("tripCancel").onclick = () => tripDialog.close();
document.getElementById("tripDelete").onclick = async () => {
  if (!confirm(`「${trip.name}」を削除しますか？元にもどせません。`)) return;
  tripDialog.close();
  try {
    await api("DELETE", trip.id);
    trip = null;
    location.hash = "#/";
    toast("削除しました");
  } catch (e) {
    if (e.message !== "unauthorized") toast("削除できませんでした：" + e.message, true);
  }
};

// ---------- 道案内 ----------
function route() {
  if (!localStorage.getItem(PASS_KEY)) return renderLogin();
  const m = location.hash.match(/^#\/trip\/([a-z0-9-]+)/);
  if (m) loadTrip(m[1]);
  else {
    trip = null;
    renderList();
  }
}
window.addEventListener("hashchange", route);
route();
