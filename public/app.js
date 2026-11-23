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
const fab = document.getElementById("fab");
let trip = null; // いま開いている旅
let editingItemId = null;

// ---------- 写真リサイズ ----------
function resizeImage(file, maxPx = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

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
// 指定した行程IDのすぐ後ろに挿入（時刻なし新規行程用）
function insertAfter(afterId, item) {
  const idx = trip.items.findIndex(it => it.id === afterId);
  if (idx === -1) trip.items.push(item);
  else trip.items.splice(idx + 1, 0, item);
}

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
  fab.hidden = true;
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

function logEntryHtml(log, itemId) {
  return `
    <div class="log-entry" data-log-id="${esc(log.id)}" data-item-id="${esc(itemId)}">
      <div class="log-time">${log.time ? esc(log.time) : "—"}</div>
      <div class="log-body">
        ${log.body ? `<div class="log-text">${esc(log.body)}</div>` : ""}
        ${log.photo ? `<div class="log-photo"><img src="${log.photo}" alt="写真" loading="lazy"></div>` : ""}
      </div>
    </div>`;
}

function itemHtml(it) {
  const ty = typeOf(it.type);
  const amount = Number(it.amount) || 0;
  const status = amount > 0 ? (it.paid ? `<span class="paid">支払い済み</span>` : `<span class="unpaid">未払い</span>`) : "";
  const logs = (it.logs || []).slice().sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  return `
    <div class="item${it.skipped ? " skipped" : ""}" data-id="${esc(it.id)}">
      <div class="time">${it.time ? esc(it.time) : "—"}${it.endTime ? `<small>〜${esc(it.endTime)}</small>` : ""}</div>
      <div class="item-main">
        <div class="title"><i class="dot" style="background:${ty.color}"></i><span>${esc(it.title)}</span></div>
        <div class="meta">${esc(ty.label)}${status ? " ・ " + status : ""}</div>
        ${it.memo ? `<div class="note">${esc(it.memo)}</div>` : ""}
        ${it.photo ? `<div class="item-photo"><img src="${it.photo}" alt="写真" loading="lazy"></div>` : ""}
        ${logs.length ? `<div class="log-list">${logs.map(l => logEntryHtml(l, it.id)).join("")}</div>` : ""}
        <div class="log-add-row no-print"><button type="button" class="log-add-btn" data-log-item="${esc(it.id)}">📝 記録を足す</button></div>
      </div>
      <div class="amount">${amount > 0 ? yen(amount) : ""}</div>
      <div class="move no-print"><button type="button" data-move="-1" aria-label="上へ">↑</button><button type="button" data-move="1" aria-label="下へ">↓</button></div>
    </div>
    <div class="item-add-row no-print">
      <button type="button" class="item-add-btn" data-add-after="${esc(it.id)}" data-day="${esc(it.date || '')}">＋</button>
      <div class="inline-add-form" id="inline-add-${esc(it.id)}" hidden>
        <div class="inline-add-header">
          <span class="inline-add-label">⊕ 次の行程を追加</span>
          <button type="button" class="inline-add-close" data-close-inline="${esc(it.id)}">✕</button>
        </div>
        <div class="inline-add-hint">前の行程を見ながら入力</div>
        <div class="inline-add-fields">
          <div class="inline-add-row">
            <label class="inline-label">開始<input type="time" class="ia-time" data-ia-field="time"></label>
            <label class="inline-label">終了<input type="time" class="ia-endtime" data-ia-field="endTime"></label>
          </div>
          <input type="text" class="ia-title" data-ia-field="title" placeholder="行程名（例：白馬駅周辺を散策）">
          <div class="inline-add-row">
            <label class="inline-label">種類
              <select class="ia-type" data-ia-field="type">
                ${TYPES.map(t => `<option value="${t.key}">${t.label}</option>`).join("")}
              </select>
            </label>
            <label class="inline-label">金額
              <input type="number" class="ia-amount" data-ia-field="amount" placeholder="0" min="0" inputmode="numeric">
            </label>
          </div>
        </div>
        <div class="inline-add-actions">
          <button type="button" class="inline-add-save primary" data-save-inline="${esc(it.id)}" data-day="${esc(it.date || '')}">保存</button>
          <button type="button" class="ghost small" data-close-inline="${esc(it.id)}">キャンセル</button>
        </div>
      </div>
    </div>`;
}

function renderTrip() {
  const t = trip;
  t.extras = t.extras || [];
  t.notes = t.notes || [];
  t.spends = t.spends || [];
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
        <div class="day"><h3>${esc(dateLabel(day))}</h3><span class="subtotal">小計 ${yen(sub)}</span><button class="day-add no-print" data-add="${esc(day)}" aria-label="この日に行程を足す">＋</button></div>
        ${items.map(itemHtml).join("") || `<p class="muted">まだ行程がありません</p>`}
        <div class="toolbar add-day no-print">
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
    ${byType.length ? `<div class="card breakdown" style="margin-top:22px"><h2>種類ごとの内訳</h2>${byType.map((x) => `<div><span><i class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${x.color};margin-right:6px"></i>${esc(x.label)}</span><b>${yen(x.amount)}</b></div>`).join("")}</div>` : ""}
    <div class="section-divider"></div>
    <div class="day" style="margin-top:28px"><h3>📝 旅のメモ・記録</h3></div>
    ${(() => {
      const days = tripDays(t).filter(Boolean);
      if (!t.notes.length) return `<p class="muted">旅の途中で気づいたこと、感想、ちょっとした記録をここに残せます</p>`;
      const byDay = {};
      t.notes.forEach(n => { (byDay[n.date || ""] = byDay[n.date || ""] || []).push(n); });
      return Object.keys(byDay).sort((a,b) => a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)).map(day => `
        <div class="note-day-label">${day ? esc(dateLabel(day, false)) : "日付なし"}</div>
        ${byDay[day].sort((a,b) => (a.time||"").localeCompare(b.time||"")).map(noteHtml).join("")}
      `).join("");
    })()}
    <div class="toolbar add-day no-print"><button class="small" id="addNote">＋ メモを足す</button></div>
    <div class="section-divider"></div>
    <div class="day" style="margin-top:28px">
      <h3>💴 用途別支出</h3>
      <span class="subtotal">${t.spends.length ? yen(t.spends.reduce((s,x) => s + (Number(x.amount)||0), 0)) : ""}</span>
    </div>
    ${t.spends.length ? t.spends.map(x => `
      <div class="item spend-item" data-spend="${esc(x.id)}">
        <div class="time">—</div>
        <div>
          <div class="title"><span>${esc(x.category)}</span></div>
          ${x.memo ? `<div class="meta muted">${esc(x.memo)}</div>` : ""}
        </div>
        <div class="amount">${yen(x.amount)}</div>
      </div>`).join("") : `<p class="muted">おみやげ・食事・観光など、用途ごとに金額を入れると自動で合計が出ます</p>`}
    ${t.spends.length ? `<div class="card spend-total"><span>合計</span><b>${yen(t.spends.reduce((s,x) => s + (Number(x.amount)||0), 0))}</b></div>` : ""}
    <div class="toolbar add-day no-print"><button class="small" id="addSpend">＋ 用途別支出を足す</button></div>`;

  document.getElementById("back").onclick = () => (location.hash = "#/");
  document.getElementById("editTrip").onclick = () => openTripDialog(trip);
  document.getElementById("print").onclick = () => window.print();
  app.querySelectorAll("[data-add]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openItemDialog(null, b.dataset.add); }));
  app.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => sortDayByTime(b.dataset.sort)));
  // FAB：今日か最初の日に行程を足す
  fab.hidden = false;
  fab.onclick = () => {
    const days = tripDays(trip).filter(Boolean);
    const today = isoOf(new Date());
    const day = days.includes(today) ? today : (days[0] || trip.start || "");
    openItemDialog(null, day);
  };
  document.getElementById("addExtra").onclick = () => openExtraDialog(null);
  app.querySelectorAll("[data-extra]").forEach((el) => (el.onclick = () => openExtraDialog(el.dataset.extra)));
  document.getElementById("addNote").onclick = () => openNoteDialog(null);
  app.querySelectorAll("[data-note]").forEach((el) => (el.onclick = () => openNoteDialog(el.dataset.note)));
  document.getElementById("addSpend").onclick = () => openSpendDialog(null);
  app.querySelectorAll("[data-spend]").forEach((el) => (el.onclick = () => openSpendDialog(el.dataset.spend)));
  app.querySelectorAll("[data-add-after]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const afterId = b.dataset.addAfter;
      const form = document.getElementById(`inline-add-${afterId}`);
      if (!form) { openItemDialog(null, b.dataset.day, afterId); return; }
      // 他に開いているインライン欄を閉じる
      app.querySelectorAll(".inline-add-form").forEach(f => { if (f !== form) f.hidden = true; });
      form.hidden = !form.hidden;
      if (!form.hidden) {
        // 前の行程の終了時刻か開始時刻を初期値に
        const prevItem = trip.items.find(x => x.id === afterId);
        const defaultTime = (prevItem && (prevItem.endTime || prevItem.time)) || "";
        form.querySelector(".ia-time").value = defaultTime;
        form.querySelector(".ia-endtime").value = "";
        form.querySelector(".ia-title").value = "";
        form.querySelector(".ia-amount").value = "";
        form.querySelector(".ia-title").focus();
      }
    };
  });
  // インライン入力フォームの保存・キャンセル
  app.querySelectorAll("[data-save-inline]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const afterId = b.dataset.saveInline;
      const day = b.dataset.day;
      const form = document.getElementById(`inline-add-${afterId}`);
      const title = form.querySelector(".ia-title").value.trim();
      if (!title) { form.querySelector(".ia-title").focus(); return; }
      const it = {
        id: uid(),
        title,
        date: day,
        type: form.querySelector(".ia-type").value,
        time: form.querySelector(".ia-time").value,
        endTime: form.querySelector(".ia-endtime").value,
        amount: Math.max(0, Math.round(Number(form.querySelector(".ia-amount").value) || 0)),
        paid: false, skipped: false, memo: "", photo: null, logs: [],
      };
      insertAfter(afterId, it);
      form.hidden = true;
      renderTrip();
      save();
    };
  });
  app.querySelectorAll("[data-close-inline]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const form = document.getElementById(`inline-add-${b.dataset.closeInline}`);
      if (form) form.hidden = true;
    };
  });
  // ログ「記録を足す」ボタン
  app.querySelectorAll(".log-add-btn").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      openLogDialog(b.dataset.logItem, null);
    };
  });
  // ログエントリのタップで編集
  app.querySelectorAll(".log-entry").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      openLogDialog(el.dataset.itemId, el.dataset.logId);
    };
  });
  app.querySelectorAll(".item:not(.extra):not(.note-item):not(.spend-item)").forEach((el) => {
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

let pendingPhoto = undefined; // undefined=変更なし, null=削除, "data:..."=新しい写真
let insertAfterId = null; // 新規追加時、どの行程の後ろに入れるか

function openItemDialog(id, day, afterId = null) {
  editingItemId = id;
  insertAfterId = afterId;
  const it = id ? trip.items.find((x) => x.id === id) : { date: day || trip.start, type: "move", title: "", time: "", endTime: "", amount: "", paid: false, skipped: false, memo: "", photo: null };
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
  // 写真
  pendingPhoto = undefined;
  itemForm.photoFile.value = "";
  updatePhotoPreview(it.photo || null);
  document.getElementById("itemDelete").hidden = !id;
  itemDialog.showModal();
}

function updatePhotoPreview(src) {
  const wrap = document.getElementById("photoPreviewWrap");
  const removeBtn = document.getElementById("photoRemoveBtn");
  if (src) {
    wrap.innerHTML = `<img src="${src}" class="photo-preview-img" alt="写真プレビュー">`;
    removeBtn.style.display = "";
  } else {
    wrap.innerHTML = "";
    removeBtn.style.display = "none";
  }
}

document.getElementById("photoSelectBtn").onclick = () => document.getElementById("photoFile").click();
document.getElementById("photoFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = await resizeImage(file);
  pendingPhoto = data;
  updatePhotoPreview(data);
};
document.getElementById("photoRemoveBtn").onclick = () => {
  pendingPhoto = null;
  itemForm.photoFile.value = "";
  updatePhotoPreview(null);
};

function submitItemForm(andAddNext = false) {
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
  if (!data.title) return false;
  // 写真を反映
  if (pendingPhoto !== undefined) data.photo = pendingPhoto;
  let savedId = null;
  if (editingItemId) {
    const it = trip.items.find((x) => x.id === editingItemId);
    const moved = it.time !== data.time || it.date !== data.date;
    if (pendingPhoto === undefined) data.photo = it.photo || null;
    Object.assign(it, data);
    if (moved) placeByTime(it);
    savedId = editingItemId;
  } else {
    const it = { id: uid(), ...data };
    savedId = it.id;
    if (insertAfterId) {
      insertAfter(insertAfterId, it);
    } else if (data.time) {
      placeByTime(it);
    } else {
      let last = -1;
      trip.items.forEach((x, i) => { if (x.date <= data.date) last = i; });
      trip.items.splice(last + 1, 0, it);
    }
  }
  renderTrip();
  save();
  if (andAddNext) {
    openNextItemPanel(savedId, data.date);
  } else {
    itemDialog.close();
  }
  return true;
}

// ---------- 次の行程パネル（ダイアログ内にぶら下がる） ----------
const nextItemPanel = document.getElementById("nextItemPanel");
const nextItemForm = document.getElementById("nextItemForm");
let nextItemAfterId = null;

function openNextItemPanel(afterId, day) {
  nextItemAfterId = afterId;
  const prevIt = trip.items.find(x => x.id === afterId);
  const defaultTime = prevIt && (prevIt.endTime || prevIt.time) || "";
  const days = tripDays(trip).filter(Boolean);
  nextItemForm.date.innerHTML = days.map(d => `<option value="${esc(d)}">${esc(dateLabel(d, false))}</option>`).join("");
  nextItemForm.type.innerHTML = TYPES.map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join("");
  nextItemForm.date.value = day || days[0] || "";
  nextItemForm.time.value = defaultTime;
  nextItemForm.endTime.value = "";
  nextItemForm.title.value = "";
  nextItemForm.amount.value = "";
  nextItemForm.memo.value = "";
  nextItemForm.paid.checked = false;
  nextItemPanel.hidden = false;
  nextItemForm.title.focus();
  nextItemPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function submitNextItemForm(andAddMore = false) {
  const f = nextItemForm;
  const title = f.title.value.trim();
  if (!title) { f.title.focus(); return; }
  const it = {
    id: uid(), title, date: f.date.value, type: f.type.value,
    time: f.time.value, endTime: f.endTime.value,
    amount: Math.max(0, Math.round(Number(f.amount.value) || 0)),
    paid: f.paid.checked, skipped: false, memo: f.memo.value.trim(),
    photo: null, logs: [],
  };
  insertAfter(nextItemAfterId, it);
  nextItemAfterId = it.id;
  renderTrip();
  save();
  if (andAddMore) {
    openNextItemPanel(it.id, it.date);
  } else {
    nextItemPanel.hidden = true;
    itemDialog.close();
  }
}

nextItemForm.onsubmit = (e) => { e.preventDefault(); submitNextItemForm(false); };
document.getElementById("nextItemSave").onclick = (e) => { e.preventDefault(); submitNextItemForm(false); };
document.getElementById("nextItemSaveAndAdd").onclick = () => submitNextItemForm(true);
document.getElementById("nextItemCancel").onclick = () => { nextItemPanel.hidden = true; };

itemForm.onsubmit = (e) => { e.preventDefault(); submitItemForm(false); };
document.getElementById("itemSaveAndAdd").onclick = () => submitItemForm(true);
document.getElementById("itemCancel").onclick = () => itemDialog.close();
document.getElementById("itemDelete").onclick = () => {
  if (!confirm("この行程を削除しますか？（「行かなかった」にすれば、消さずに残せます）")) return;
  trip.items = trip.items.filter((x) => x.id !== editingItemId);
  itemDialog.close();
  renderTrip();
  save();
};

// ---------- メモ・記録の表示 ----------
function noteHtml(n) {
  return `
    <div class="item note-item" data-note="${esc(n.id)}">
      <div class="time">${n.time ? esc(n.time) : "—"}</div>
      <div>
        <div class="note-body">${esc(n.body)}</div>
      </div>
      <div></div>
    </div>`;
}

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

// ---------- メモ・記録の編集 ----------
const noteDialog = document.getElementById("noteDialog");
const noteForm = document.getElementById("noteForm");
let editingNoteId = null;

function openNoteDialog(id) {
  editingNoteId = id;
  const n = id ? trip.notes.find(x => x.id === id) : { date: trip.start || "", time: "", body: "" };
  document.getElementById("noteDialogTitle").textContent = id ? "メモを直す" : "メモ・記録を足す";
  const days = tripDays(trip).filter(Boolean);
  noteForm.date.innerHTML = days.map(d => `<option value="${esc(d)}">${esc(dateLabel(d, false))}</option>`).join("") + `<option value="">日付なし</option>`;
  noteForm.date.value = n.date || "";
  noteForm.time.value = n.time || "";
  noteForm.body.value = n.body || "";
  document.getElementById("noteDelete").hidden = !id;
  noteDialog.showModal();
}

noteForm.onsubmit = (e) => {
  e.preventDefault();
  const data = { date: noteForm.date.value, time: noteForm.time.value, body: noteForm.body.value.trim() };
  if (!data.body) return;
  trip.notes = trip.notes || [];
  if (editingNoteId) Object.assign(trip.notes.find(x => x.id === editingNoteId), data);
  else trip.notes.push({ id: uid(), ...data });
  noteDialog.close();
  renderTrip();
  save();
};
document.getElementById("noteCancel").onclick = () => noteDialog.close();
document.getElementById("noteDelete").onclick = () => {
  if (!confirm("このメモを削除しますか？")) return;
  trip.notes = trip.notes.filter(x => x.id !== editingNoteId);
  noteDialog.close();
  renderTrip();
  save();
};

// ---------- ログ（行程にぶら下がる記録）の編集 ----------
const logDialog = document.getElementById("logDialog");
const logForm = document.getElementById("logForm");
let editingLogItemId = null;
let editingLogId = null;
let pendingLogPhoto = undefined;

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function openLogDialog(itemId, logId) {
  editingLogItemId = itemId;
  editingLogId = logId;
  const item = trip.items.find(x => x.id === itemId);
  item.logs = item.logs || [];
  const log = logId ? item.logs.find(x => x.id === logId) : { body: "", time: nowTime(), photo: null };
  document.getElementById("logDialogTitle").textContent = logId ? "記録を直す" : "記録を残す";
  logForm.body.value = log.body || "";
  logForm.time.value = log.time || nowTime();
  pendingLogPhoto = undefined;
  logForm.logPhotoFile.value = "";
  updateLogPhotoPreview(log.photo || null);
  document.getElementById("logDelete").hidden = !logId;
  logDialog.showModal();
}

function updateLogPhotoPreview(src) {
  const wrap = document.getElementById("logPhotoPreviewWrap");
  const removeBtn = document.getElementById("logPhotoRemoveBtn");
  if (src) {
    wrap.innerHTML = `<img src="${src}" class="photo-preview-img" alt="写真プレビュー">`;
    removeBtn.style.display = "";
  } else {
    wrap.innerHTML = "";
    removeBtn.style.display = "none";
  }
}

document.getElementById("logPhotoSelectBtn").onclick = () => document.getElementById("logPhotoFile").click();
document.getElementById("logPhotoFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = await resizeImage(file);
  pendingLogPhoto = data;
  updateLogPhotoPreview(data);
};
document.getElementById("logPhotoRemoveBtn").onclick = () => {
  pendingLogPhoto = null;
  logForm.logPhotoFile.value = "";
  updateLogPhotoPreview(null);
};

logForm.onsubmit = (e) => {
  e.preventDefault();
  const item = trip.items.find(x => x.id === editingLogItemId);
  item.logs = item.logs || [];
  const data = {
    body: logForm.body.value.trim(),
    time: logForm.time.value,
  };
  if (pendingLogPhoto !== undefined) {
    data.photo = pendingLogPhoto;
  }
  if (editingLogId) {
    const log = item.logs.find(x => x.id === editingLogId);
    if (pendingLogPhoto === undefined) data.photo = log.photo || null;
    Object.assign(log, data);
  } else {
    data.photo = pendingLogPhoto || null;
    item.logs.push({ id: uid(), ...data });
  }
  logDialog.close();
  renderTrip();
  save();
};
document.getElementById("logCancel").onclick = () => logDialog.close();
document.getElementById("logDelete").onclick = () => {
  if (!confirm("この記録を削除しますか？")) return;
  const item = trip.items.find(x => x.id === editingLogItemId);
  item.logs = item.logs.filter(x => x.id !== editingLogId);
  logDialog.close();
  renderTrip();
  save();
};

// ---------- 用途別支出の編集 ----------
const spendDialog = document.getElementById("spendDialog");
const spendForm = document.getElementById("spendForm");
let editingSpendId = null;

function openSpendDialog(id) {
  editingSpendId = id;
  const x = id ? trip.spends.find(s => s.id === id) : { category: "", amount: "", memo: "" };
  spendForm.category.value = x.category || "";
  spendForm.amount.value = x.amount ? x.amount : "";
  spendForm.memo.value = x.memo || "";
  document.getElementById("spendDelete").hidden = !id;
  spendDialog.showModal();
}

spendForm.onsubmit = (e) => {
  e.preventDefault();
  const data = {
    category: spendForm.category.value.trim(),
    amount: Math.max(0, Math.round(Number(spendForm.amount.value) || 0)),
    memo: spendForm.memo.value.trim(),
  };
  if (!data.category || !data.amount) return;
  trip.spends = trip.spends || [];
  if (editingSpendId) Object.assign(trip.spends.find(x => x.id === editingSpendId), data);
  else trip.spends.push({ id: uid(), ...data });
  spendDialog.close();
  renderTrip();
  save();
};
document.getElementById("spendCancel").onclick = () => spendDialog.close();
document.getElementById("spendDelete").onclick = () => {
  if (!confirm("この支出を削除しますか？")) return;
  trip.spends = trip.spends.filter(x => x.id !== editingSpendId);
  spendDialog.close();
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
