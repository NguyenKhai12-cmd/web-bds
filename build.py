"""Tạo dữ liệu web từ API công khai của salepro.com.

Chạy:  python -I build.py            (dùng cache trong .cache/, chỉ tải phần còn thiếu)
       python -I build.py --refresh  (tải lại toàn bộ JSON từ API)

Kết quả: projects.js (danh sách), data/<slug>.js (chi tiết từng dự án), img/<id>.jpg (ảnh đại diện).
"""
import html, json, os, re, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, ".cache")
API = "https://salepro.com/api/rest_api/pu/property/master/data/"
REFRESH = "--refresh" in sys.argv
REGION = {1: "Bắc", 4: "Bắc", 5: "Bắc", 3: "Trung", 6: "Trung", 7: "Trung", 9: "Trung", 2: "Nam", 8: "Nam"}
TYPE = {"high_rise": "Cao tầng", "low_rise": "Thấp tầng"}
IMG_HOST = "https://s3-hfx03.fptcloud.com/"


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0 and not (REFRESH and path.endswith(".json")):
        return True
    try:
        req = urllib.request.Request(urllib.parse.quote(url, safe=":/%()_.-~?=&"), headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
        open(path, "wb").write(body)
        return True
    except Exception as e:
        print("LỖI", url, e)
        return False


# ---------- làm sạch HTML từ CMS: chỉ giữ thẻ trình bày, bỏ script/style/thuộc tính ----------
KEEP = {"p", "ul", "ol", "li", "strong", "b", "em", "i", "br", "h3", "h4", "h5", "table", "thead", "tbody", "tr", "td", "th", "img"}
VOID = {"br", "img"}
DROP_CONTENT = {"script", "style", "iframe", "noscript"}


class Clean(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in DROP_CONTENT:
            self.skip += 1
        elif self.skip or tag not in KEEP:
            return
        elif tag == "img":
            src = dict(attrs).get("src") or ""
            if src.startswith(IMG_HOST):  # chỉ nhận ảnh từ kho ảnh dự án
                self.out.append(f'<img src="{html.escape(src)}" alt="" loading="lazy">')
        else:
            self.out.append(f"<{tag}>")

    def handle_endtag(self, tag):
        if tag in DROP_CONTENT:
            self.skip = max(0, self.skip - 1)
        elif not self.skip and tag in KEEP and tag not in VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))


def clean(s):
    if not s:
        return ""
    c = Clean()
    c.feed(s)
    c.close()
    out = re.sub(r"\s+", " ", "".join(c.out))
    out = re.sub(r"<p>\s*(<br>\s*)*</p>", "", out).strip()
    return "" if not re.sub(r"<[^>]+>|\s", "", out) and "<img" not in out else out


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def img(u):
    return u if isinstance(u, str) and u.startswith(IMG_HOST) else ""


def youtube(u):
    m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([\w-]{11})", u or "")
    return m.group(1) if m else ""


def map_src(iframe):
    m = re.search(r'src="(https://www\.google\.com/maps/embed\?[^"]+)"', iframe or "")
    return html.unescape(m.group(1)) if m else ""


def name(s):
    return re.sub(r"\s+", " ", re.sub(r"\s*_(TT|CT)$", "", (s or "").strip()))


def block(l, key):
    t, c = l.get(f"{key}_title"), l.get(f"{key}_content")
    if not (t or c):
        return None
    return {"title": text(t), "content": text(c), "video": youtube(l.get(f"{key}_video_url")),
            "img": img((l.get(f"{key}_image") or {}).get("image_url"))}


def tilemap(layouts):
    """Bản đồ mặt bằng dạng tile (Leaflet) — chỉ lấy ảnh nền, không lấy trạng thái căn."""
    m = next((a for a in layouts if a.get("attach_is_default")), layouts[0] if layouts else None)
    try:
        url = m["attach_url"]
        assert url.startswith(IMG_HOST) and "{z}" in url
        return {"url": url, "maxZoom": int(m["attach_max_zoom"]), "center": json.loads(m["attach_center"]),
                "bounds": json.loads(m["attach_max_bounds"])}
    except (TypeError, KeyError, ValueError, AssertionError):
        return None


def detail(x, d, l, layouts):
    info = d.get("project_info") or {}
    return {
        "tilemap": tilemap(layouts),
        "slug": x["project_slug"], "name": name(x["project_name"]), "type": TYPE.get(x["project_type"], ""),
        "investor": "" if x.get("investor") in (None, "KHÁC") else x["investor"],
        "addr": (x.get("project_address") or "").strip().rstrip("."), "slogan": (x.get("project_slogan") or "").strip(),
        "soon": x.get("state") == "launching_soon", "hot": bool(x.get("is_hot")),
        "color": l.get("secondary_color") if re.fullmatch(r"#[0-9a-fA-F]{6}", l.get("secondary_color") or "") else "",
        "accent": l.get("primary_color") if re.fullmatch(r"#[0-9a-fA-F]{6}", l.get("primary_color") or "") else "",
        "cover": img((l.get("project_image") or {}).get("image_url")) or img((x.get("avatar") or {}).get("image_url")),
        "banners": [u for u in (img(b.get("image_url")) for b in l.get("banner_desktop") or []) if u],
        "stats": [{"name": text(s.get("name")), "value": text(s.get("value"))} for s in l.get("project_info") or [] if s.get("value")],
        "facts": [[k, text(info.get(f))] for k, f in (("Hình thức sở hữu", "ownership_type"), ("Mật độ xây dựng", "construction_density"),
                                                       ("Quy mô phát triển", "development_scale"), ("Tiến độ", "progress")) if text(info.get(f))],
        "desc": clean(l.get("project_html_description")) or clean(info.get("project_overview")),
        "location": clean(info.get("location")), "map": map_src(info.get("iframe_location")),
        "products": [{"name": text(p.get("product_name")), "price": text(p.get("product_price")),
                      "features": clean(p.get("product_features")), "img": img(p.get("image_url"))} for p in l.get("product") or []],
        "floorplans": [{"name": text(f.get("floorplan_name")), "img": img(f.get("image_url"))} for f in l.get("floor_plan") or [] if img(f.get("image_url"))],
        "subdivisions": [{"name": text(s.get("name")), "count": s.get("apartment_count") or 0, "img": img((s.get("avatar") or {}).get("url"))}
                         for s in d.get("subdivisions") or []],
        "amenities": [{"name": text(a.get("amenity_name")), "img": img(a.get("image_url"))} for a in l.get("amenities") or [] if img(a.get("image_url"))],
        "discovery": block(l, "discovery"), "entertainment": block(l, "entertainment"),
        # link ngoài, mở tab mới: chỉ nhận https (chặn javascript:/data:)
        "tour360": (info.get("image_360") or "").strip() if re.fullmatch(r"https://[^\s\"'<>]+", (info.get("image_360") or "").strip()) else "",
        # cố ý KHÔNG lấy: contact_data (SĐT nhân viên SalePro), sale_policy_images, link_general (tài liệu bị khóa sau đăng nhập)
    }


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "img"), exist_ok=True)
    lp = os.path.join(CACHE, "list.json")
    assert fetch(API + "search_duan_data/?limit=500&page=1", lp), "không tải được danh sách"
    raw = json.load(open(lp, encoding="utf-8"))
    data = raw["data"]
    assert len(data) == raw["total"], f"danh sách thiếu: {len(data)}/{raw['total']}"

    jobs = [(f"{API}get_project_{k}/?project_id={x['project_slug']}", os.path.join(CACHE, f"{x['project_slug']}.{k}.json"))
            for x in data for k in ("detail", "landing")]
    pid = {}  # slug -> project_id số (API bản đồ cần id số, có trong detail)
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda j: fetch(*j), jobs))
    for x in data:
        try:
            pid[x["project_slug"]] = json.load(open(os.path.join(CACHE, f"{x['project_slug']}.detail.json"), encoding="utf-8"))["data"]["project_info"]["project_id"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
    jobs += [(f"{API}get_layout_duan_canho/?project_id={i}", os.path.join(CACHE, f"layout-{i}.json")) for i in pid.values()]
    jobs += [(x["avatar"]["image_url"], os.path.join(ROOT, "img", f"{x['project_id']}.jpg")) for x in data if img((x.get("avatar") or {}).get("image_url"))]
    with ThreadPoolExecutor(8) as ex:
        failed = [j for j, ok in zip(jobs, ex.map(lambda j: fetch(*j), jobs)) if not ok]

    rows, missing = [], []
    for x in sorted(data, key=lambda x: (not x.get("is_hot"), x.get("sequence") or 999)):
        slug = x["project_slug"]
        try:
            d = json.load(open(os.path.join(CACHE, f"{slug}.detail.json"), encoding="utf-8"))["data"] or {}
            l = (json.load(open(os.path.join(CACHE, f"{slug}.landing.json"), encoding="utf-8"))["data"] or [{}])[0]
        except (OSError, ValueError, KeyError):
            d, l = {}, {}
            missing.append(slug)
        try:
            layouts = json.load(open(os.path.join(CACHE, f"layout-{pid[slug]}.json"), encoding="utf-8"))["data"] or []
        except (OSError, ValueError, KeyError):
            layouts = []
        price = x.get("min_apartment_price") or 0
        rows.append({
            "slug": slug, "name": name(x["project_name"]), "type": TYPE.get(x["project_type"], ""), "region": REGION.get(x["area"], ""),
            "investor": "" if x.get("investor") in (None, "KHÁC") else x["investor"], "hot": bool(x.get("is_hot")),
            "soon": x.get("state") == "launching_soon", "views": x.get("view_count") or 0,
            "price": round(price / 1e9, 1) if price >= 1e8 else 0,  # tỷ đồng; giá < 100tr là dữ liệu sai
            "img": f"img/{x['project_id']}.jpg", "slogan": (x.get("project_slogan") or "").strip(),
            "addr": (x.get("project_address") or "").strip().rstrip("."),
        })
        p = detail(x, d, l, layouts)
        p["price"] = rows[-1]["price"]
        p["region"] = rows[-1]["region"]
        open(os.path.join(ROOT, "data", f"{slug}.js"), "w", encoding="utf-8").write(
            "window.PROJECT = " + json.dumps(p, ensure_ascii=False, separators=(",", ":")) + ";\n")

    open(os.path.join(ROOT, "projects.js"), "w", encoding="utf-8").write(
        "// Dữ liệu dự án (nguồn: salepro.com). Tạo lại bằng: python -I build.py\nconst projects = "
        + json.dumps(rows, ensure_ascii=False, indent=0) + ";\n")

    # sitemap.xml + robots.txt cho Google — chỉ khi có tên miền: python -I build.py --site https://tenmien.vn
    if "--site" in sys.argv:
        site = sys.argv[sys.argv.index("--site") + 1].rstrip("/")
        assert re.fullmatch(r"https://[\w.-]+(/[\w.-]*)*", site), "tên miền phải dạng https://tenmien.vn"
        urls = [f"{site}/", f"{site}/tin-tuc.html", f"{site}/chinh-sach-bao-mat.html"] + [f"{site}/du-an.html?slug={r['slug']}" for r in rows]
        open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(
            '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "".join(f"<url><loc>{html.escape(u)}</loc></url>\n" for u in urls) + "</urlset>\n")
        open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8").write(f"User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: {site}/sitemap.xml\n")
        print(f"sitemap: {len(urls)} trang")

    # tự kiểm tra
    assert all(r["slug"] and r["name"] and r["type"] and r["region"] for r in rows), "thiếu trường bắt buộc"
    assert len({r["slug"] for r in rows}) == len(rows), "trùng slug"
    assert all(re.fullmatch(r"[a-z0-9-]+", r["slug"]) for r in rows), "slug có ký tự lạ"
    assert all(os.path.exists(os.path.join(ROOT, r["img"])) for r in rows), "thiếu ảnh đại diện"
    assert "<script" not in clean('<p>a<script>alert(1)</script><img src="x" onerror="y"></p>'), "bộ lọc HTML hỏng"
    print(f"{len(rows)} dự án, {len(failed)} lỗi tải, {len(missing)} dự án thiếu dữ liệu chi tiết: {missing[:5]}")


if __name__ == "__main__":
    main()
