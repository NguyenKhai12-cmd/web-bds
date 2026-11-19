/**
 * Backend miễn phí cho website, chạy trên Google Sheet:
 *   1) Nhận form "Đăng ký tư vấn" → sheet "Khach hang"
 *   2) Quản lý bài viết (trang admin.html) → sheet "Bai viet"
 *   3) Cung cấp bài viết đã đăng cho trang tin-tuc.html / bai-viet.html
 * Cách cài: xem HUONG_DAN.md, mục 1.
 * Tạo tài khoản admin: mở Sheet → menu "Quản trị web" → "Tạo / đổi mật khẩu admin".
 */
const LEAD_SHEET = "Khach hang";
const LEAD_HEADERS = ["Thời gian", "Họ tên", "Số điện thoại", "Dự án", "Nhu cầu", "Ghi chú", "Trang gửi"];
const NOTIFY_EMAIL = ""; // điền email để nhận thông báo khi có khách mới (để trống = không gửi)

const POST_SHEET = "Bai viet";
const POST_COLS = ["id", "slug", "title", "summary", "cover", "content", "status", "project", "createdAt", "updatedAt", "author"];
const SESSION_HOURS = 6;
const MAX_FAILS = 5;            // sai mật khẩu 5 lần → khóa 15 phút
const LOCK_MINUTES = 15;

// ===================== điểm vào =====================
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === "posts") return out({ok: true, posts: publicPosts().map(({content, ...rest}) => rest)});
  if (p.action === "post") {
    const post = publicPosts().find(x => x.slug === p.slug);
    return out(post ? {ok: true, post} : {ok: false, error: "Không tìm thấy bài viết"});
  }
  return out({ok: false, error: "action không hợp lệ"});
}

function doPost(e) {
  // admin.html gửi JSON (text/plain) có "action"; form khách gửi dạng form-urlencoded
  let body = null;
  try { body = JSON.parse(e.postData.contents); } catch (err) { /* không phải JSON → form khách */ }
  if (body && body.action) return out(admin(body));
  return saveLead((e && e.parameter) || {});
}

// ===================== form khách hàng =====================
function saveLead(p) {
  const clip = (v, n) => String(v || "").replace(/^[=+\-@]/, "'$&").slice(0, n); // chặn công thức độc hại
  const phone = String(p.phone || "").replace(/[^\d+]/g, "");
  if (!/^(\+?84|0)\d{9,10}$/.test(phone) || p.website) return out({ok: false});
  withLock(() => {
    const sh = sheet(LEAD_SHEET, LEAD_HEADERS);
    const row = [new Date(), clip(p.name, 100), "'" + phone, clip(p.project, 150), clip(p.need, 100), clip(p.note, 1000), clip(p.page, 300)];
    sh.appendRow(row);
    if (NOTIFY_EMAIL) MailApp.sendEmail(NOTIFY_EMAIL, "Khách mới: " + row[1] + " – " + row[3], LEAD_HEADERS.map((h, i) => h + ": " + row[i]).join("\n"));
  });
  return out({ok: true});
}

// ===================== API quản trị =====================
function admin(b) {
  if (b.action === "login") return login(String(b.user || "").trim().toLowerCase(), String(b.pass || ""));
  const user = b.token && CacheService.getScriptCache().get("tok_" + b.token);
  if (!user) return {ok: false, error: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại", auth: false};
  if (b.action === "logout") { CacheService.getScriptCache().remove("tok_" + b.token); return {ok: true}; }
  if (b.action === "list") return {ok: true, user, posts: allPosts()};
  if (b.action === "save") return savePost(b.post || {}, user);
  if (b.action === "delete") return deletePost(String(b.id || ""));
  return {ok: false, error: "action không hợp lệ"};
}

function login(user, pass) {
  const cache = CacheService.getScriptCache(), failKey = "fail_" + user;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILS) return {ok: false, error: `Sai quá ${MAX_FAILS} lần, thử lại sau ${LOCK_MINUTES} phút`};
  const admins = JSON.parse(PropertiesService.getScriptProperties().getProperty("ADMINS") || "{}");
  const acc = admins[user];
  if (!acc || hash(acc.salt + pass) !== acc.hash) {
    cache.put(failKey, String(fails + 1), LOCK_MINUTES * 60);
    return {ok: false, error: "Sai tên đăng nhập hoặc mật khẩu"};
  }
  cache.remove(failKey);
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put("tok_" + token, user, SESSION_HOURS * 3600);
  return {ok: true, token, user};
}

function savePost(p, user) {
  const s = v => String(v == null ? "" : v).trim();
  const post = {
    id: s(p.id), title: s(p.title).slice(0, 200), summary: s(p.summary).slice(0, 500),
    cover: /^https:\/\/[^\s"'<>]+$/.test(s(p.cover)) ? s(p.cover) : "",
    content: s(p.content), status: p.status === "published" ? "published" : "draft",
    project: /^[a-z0-9-]*$/.test(s(p.project)) ? s(p.project) : "",
    slug: slugify(s(p.slug) || s(p.title)),
  };
  if (!post.title) return {ok: false, error: "Thiếu tiêu đề"};
  if (!post.slug) return {ok: false, error: "Đường dẫn (slug) không hợp lệ"};
  if (post.content.length > 45000) return {ok: false, error: "Nội dung quá dài (tối đa 45.000 ký tự)"};

  return withLock(() => {
    const sh = sheet(POST_SHEET, POST_COLS), rows = allPosts();
    if (rows.some(r => r.slug === post.slug && r.id !== post.id)) return {ok: false, error: "Đường dẫn (slug) đã được dùng cho bài khác"};
    const now = new Date().toISOString(), i = rows.findIndex(r => r.id === post.id);
    if (i < 0) { post.id = Utilities.getUuid(); post.createdAt = now; } else post.createdAt = rows[i].createdAt;
    post.updatedAt = now; post.author = user;
    const values = [POST_COLS.map(c => post[c] || "")];
    const range = i < 0 ? sh.getRange(sh.getLastRow() + 1, 1, 1, POST_COLS.length) : sh.getRange(i + 2, 1, 1, POST_COLS.length);
    range.setNumberFormat("@").setValues(values); // lưu dạng chữ thuần: nội dung bắt đầu bằng "=" không thành công thức
    CacheService.getScriptCache().remove("public_posts");
    return {ok: true, post};
  });
}

function deletePost(id) {
  return withLock(() => {
    const i = allPosts().findIndex(r => r.id === id);
    if (i < 0) return {ok: false, error: "Không tìm thấy bài viết"};
    sheet(POST_SHEET, POST_COLS).deleteRow(i + 2);
    CacheService.getScriptCache().remove("public_posts");
    return {ok: true};
  });
}

// ===================== đọc bài viết =====================
function allPosts() {
  const sh = sheet(POST_SHEET, POST_COLS), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, POST_COLS.length).getDisplayValues()
    .map(r => Object.fromEntries(POST_COLS.map((c, j) => [c, r[j]])));
}

function publicPosts() {
  const cache = CacheService.getScriptCache(), hit = cache.get("public_posts");
  if (hit) return JSON.parse(hit);
  const posts = allPosts().filter(p => p.status === "published").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const json = JSON.stringify(posts);
  if (json.length < 90000) cache.put("public_posts", json, 300); // cache tối đa 100KB/khóa
  return posts;
}

// ===================== tài khoản admin (chạy từ menu trong Sheet) =====================
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Quản trị web")
    .addItem("Tạo / đổi mật khẩu admin", "setAdmin")
    .addItem("Xóa tài khoản admin", "removeAdmin")
    .addItem("Xem danh sách admin", "listAdmins")
    .addToUi();
}

function setAdmin() {
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt("Tên đăng nhập (chữ thường, không dấu)", ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  const user = u.getResponseText().trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(user)) return ui.alert("Tên đăng nhập 3–30 ký tự: a-z, 0-9, . _ -");
  const pw = ui.prompt("Mật khẩu cho " + user + " (ít nhất 10 ký tự)", ui.ButtonSet.OK_CANCEL);
  if (pw.getSelectedButton() !== ui.Button.OK) return;
  const pass = pw.getResponseText();
  if (pass.length < 10) return ui.alert("Mật khẩu phải có ít nhất 10 ký tự");
  const props = PropertiesService.getScriptProperties();
  const admins = JSON.parse(props.getProperty("ADMINS") || "{}");
  const salt = Utilities.getUuid();
  admins[user] = {salt, hash: hash(salt + pass)};
  props.setProperty("ADMINS", JSON.stringify(admins));
  ui.alert("Đã lưu tài khoản admin: " + user);
}

function removeAdmin() {
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt("Tên đăng nhập cần xóa", ui.ButtonSet.OK_CANCEL);
  if (u.getSelectedButton() !== ui.Button.OK) return;
  const props = PropertiesService.getScriptProperties();
  const admins = JSON.parse(props.getProperty("ADMINS") || "{}");
  const user = u.getResponseText().trim().toLowerCase();
  if (!admins[user]) return ui.alert("Không có tài khoản " + user);
  delete admins[user];
  props.setProperty("ADMINS", JSON.stringify(admins));
  ui.alert("Đã xóa " + user + " (phiên đang mở sẽ hết hạn trong tối đa " + SESSION_HOURS + " giờ)");
}

function listAdmins() {
  const admins = JSON.parse(PropertiesService.getScriptProperties().getProperty("ADMINS") || "{}");
  SpreadsheetApp.getUi().alert(Object.keys(admins).join("\n") || "Chưa có tài khoản admin");
}

// ===================== tiện ích =====================
function hash(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function slugify(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // tránh 2 người ghi đè cùng lúc
  try { return fn(); } finally { lock.releaseLock(); }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
