const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const tagsHtml = p => `<span class="tag">${p.type}</span>${p.soon?'<span class="tag soon">Sắp mở bán</span>':''}${p.hot?'<span class="tag hot">HOT</span>':''}`;
const meta = p => [p.investor && `Chủ đầu tư: ${esc(p.investor)}`, p.price && `Giá từ <b>${p.price.toLocaleString("vi-VN")} tỷ</b>`].filter(Boolean).join(" · ");
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
const phoneFmt = n => n.replace(/^(\d{4})(\d{3})(\d+)$/, "$1 $2 $3");

// ---------- thương hiệu & liên hệ lấy từ assets/config.js ----------
document.querySelectorAll("[data-brand]").forEach(e => e.textContent = SITE.brand);
document.querySelectorAll("[data-contact]").forEach(ul => ul.innerHTML = [
  SITE.hotline && `<li><b>Hotline:</b> <a href="tel:${esc(SITE.hotline)}">${esc(phoneFmt(SITE.hotline))}</a></li>`,
  SITE.zalo && `<li><b>Zalo:</b> <a href="https://zalo.me/${esc(SITE.zalo)}" target="_blank" rel="noopener">${esc(phoneFmt(SITE.zalo))}</a></li>`,
  SITE.email && `<li><b>Email:</b> <a href="mailto:${esc(SITE.email)}">${esc(SITE.email)}</a></li>`,
  SITE.address && `<li><b>Văn phòng:</b> ${esc(SITE.address)}</li>`,
].filter(Boolean).join(""));
if ((SITE.hotline || SITE.zalo) && !("admin" in document.body.dataset)) document.body.insertAdjacentHTML("beforeend", `<div class="float-cta">
  ${SITE.zalo ? `<a href="https://zalo.me/${esc(SITE.zalo)}" target="_blank" rel="noopener" class="zalo" aria-label="Chat Zalo">Zalo</a>` : ""}
  ${SITE.hotline ? `<a href="tel:${esc(SITE.hotline)}" class="call" aria-label="Gọi hotline">📞</a>` : ""}</div>`);

// ---------- menu trên điện thoại / máy tính bảng ----------
const topNav = document.querySelector("header nav");
if (topNav && !("admin" in document.body.dataset)) {
  topNav.id = "site-nav";
  const cta = document.querySelector("header .btn");
  if (cta) topNav.insertAdjacentHTML("beforeend", `<a class="btn nav-cta" href="${cta.getAttribute("href")}">${cta.textContent}</a>`);
  const tg = document.createElement("button");
  tg.className = "nav-toggle";
  tg.setAttribute("aria-controls", "site-nav");
  tg.setAttribute("aria-expanded", "false");
  tg.setAttribute("aria-label", "Mở menu");
  tg.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
  document.querySelector("header .wrap").append(tg);
  const setOpen = open => {
    document.body.classList.toggle("nav-open", open);
    tg.setAttribute("aria-expanded", open);
    tg.setAttribute("aria-label", open ? "Đóng menu" : "Mở menu");
  };
  tg.onclick = () => setOpen(!document.body.classList.contains("nav-open"));
  topNav.addEventListener("click", e => { if (e.target.closest("a")) setOpen(false); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("nav-open")) { setOpen(false); tg.focus(); } });
  matchMedia("(min-width: 901px)").addEventListener("change", e => e.matches && setOpen(false));
}

// ---------- form đăng ký tư vấn ----------
const form = $("#form");
if (form) form.onsubmit = async e => {
  e.preventDefault();
  const ok = $("#ok"), btn = form.querySelector("button[type=submit]");
  const say = (msg, good) => { ok.textContent = msg; ok.style.display = "block"; ok.style.color = good ? "" : "#b03a2e"; };
  const data = new FormData(form);
  if (data.get("website")) return; // bot điền ô ẩn → bỏ qua im lặng
  const phone = String(data.get("phone")).replace(/[^\d+]/g, "");
  if (!/^(\+?84|0)\d{9,10}$/.test(phone)) return say("Số điện thoại chưa đúng, bạn kiểm tra lại giúp nhé.");
  if (!SITE.apiUrl) return say(`Hệ thống nhận đăng ký đang bảo trì. Bạn vui lòng gọi ${phoneFmt(SITE.hotline)} để được tư vấn ngay.`);
  data.set("phone", phone);
  data.delete("website");
  data.set("page", location.href);
  btn.disabled = true; btn.textContent = "Đang gửi…";
  try {
    // Apps Script không trả CORS header → gửi no-cors; lỗi mạng vẫn bắt được, còn lỗi phía Sheet thì không thấy.
    await fetch(SITE.apiUrl, {method: "POST", mode: "no-cors", body: new URLSearchParams(data)});
    form.reset();
    say("Cảm ơn bạn! Chuyên viên sẽ liên hệ trong thời gian sớm nhất.", true);
  } catch {
    say(`Gửi chưa thành công do lỗi mạng. Bạn thử lại hoặc gọi ${phoneFmt(SITE.hotline)} nhé.`);
  } finally {
    btn.disabled = false; btn.textContent = "Gửi đăng ký";
  }
};

// ---------- API (Google Apps Script) ----------
// GET: đọc bài viết công khai. POST JSON gửi dạng text/plain để không phải preflight CORS.
async function apiGet(params){
  if (!SITE.apiUrl) throw new Error("Chưa cấu hình apiUrl trong assets/config.js");
  const r = await fetch(SITE.apiUrl + "?" + new URLSearchParams(params));
  return r.json();
}
async function apiPost(body){
  if (!SITE.apiUrl) throw new Error("Chưa cấu hình apiUrl trong assets/config.js");
  const r = await fetch(SITE.apiUrl, {method: "POST", body: JSON.stringify(body)});
  return r.json();
}

// ---------- hiển thị nội dung bài viết (Markdown rút gọn) ----------
// Escape toàn bộ trước, rồi mới áp định dạng → người viết không chèn được HTML/script.
const safeUrl = u => /^https:\/\/[^\s"'<>]+$/.test(u) ? u : "";
function inlineMd(t){
  return t
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, u) => safeUrl(u) ? `<a href="${u}" target="_blank" rel="noopener nofollow">${txt}</a>` : txt);
}
function renderMd(src){
  return esc(src || "").replace(/\r/g, "").split(/\n{2,}/).map(block => {
    const lines = block.split("\n");
    const img = block.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (img) return safeUrl(img[2]) ? `<img src="${img[2]}" alt="${img[1]}" loading="lazy">` : "";
    if (/^### /.test(block)) return `<h4>${inlineMd(block.slice(4))}</h4>`;
    if (/^## /.test(block)) return `<h3>${inlineMd(block.slice(3))}</h3>`;
    if (lines.every(l => /^- /.test(l))) return `<ul>${lines.map(l => `<li>${inlineMd(l.slice(2))}</li>`).join("")}</ul>`;
    if (lines.every(l => /^\d+\. /.test(l))) return `<ol>${lines.map(l => `<li>${inlineMd(l.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
    if (lines.every(l => /^&gt; /.test(l))) return `<blockquote>${lines.map(l => inlineMd(l.slice(5))).join("<br>")}</blockquote>`;
    return `<p>${lines.map(inlineMd).join("<br>")}</p>`;
  }).join("");
}
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("vi-VN", {day: "2-digit", month: "2-digit", year: "numeric"}) : "";
