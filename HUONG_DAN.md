# Hướng dẫn đưa website lên mạng

## 0. Điền thông tin của bạn
Mở `assets/config.js` và sửa: tên thương hiệu, hotline, Zalo, email, địa chỉ. Logo, chân trang, khung liên hệ và nút gọi/Zalo nổi ở góc màn hình sẽ tự cập nhật trên mọi trang.

## 1. Nhận đăng ký của khách vào Google Sheet (miễn phí)
1. Tạo một Google Sheet mới, ví dụ đặt tên "Khách hàng website".
2. Trong Sheet: **Tiện ích mở rộng → Apps Script**. Xóa code mẫu, dán toàn bộ nội dung file `google-apps-script.gs`, rồi bấm **Lưu**.
   - Muốn nhận email báo mỗi khi có khách mới: điền email của bạn vào dòng `NOTIFY_EMAIL = "..."`.
3. Bấm **Triển khai → Tùy chọn triển khai mới**:
   - Loại: **Ứng dụng web**
   - Thực thi dưới dạng: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
   - Bấm Triển khai, cấp quyền khi được hỏi (Google sẽ cảnh báo "ứng dụng chưa xác minh" vì script do bạn tự viết: chọn *Nâng cao → Đi tới…*).
4. Copy **URL ứng dụng web** (dạng `https://script.google.com/macros/s/…/exec`) và dán vào `apiUrl` trong `assets/config.js`.
5. Thử gửi một form trên web: sau vài giây sẽ có một dòng mới trong sheet "Khach hang".

> Khi sửa code Apps Script, phải **Triển khai → Quản lý triển khai → Sửa → Phiên bản mới**, nếu không web vẫn gọi phiên bản cũ.

## 1b. Tài khoản admin & quản lý bài viết
Dùng chung Google Sheet và Apps Script ở mục 1, không cần cài thêm gì.
1. Mở lại Google Sheet (tải lại trang nếu vừa dán script). Trên thanh menu sẽ có thêm **Quản trị web**.
2. **Quản trị web → Tạo / đổi mật khẩu admin**: nhập tên đăng nhập, rồi nhập mật khẩu ít nhất 10 ký tự. Lần đầu Google sẽ hỏi cấp quyền.
   - Mật khẩu chỉ được lưu dưới dạng mã băm trong Script Properties, không nằm trong code hay trong bảng tính.
   - Muốn thêm người quản trị: chạy lại mục này với tên khác. Muốn thu hồi quyền: **Xóa tài khoản admin**.
3. Vào `https://tenmien-cua-ban/admin.html` và đăng nhập.
   - Viết bài, xem trước ngay bên cạnh, lưu nháp hoặc đăng công khai, gắn bài với một dự án.
   - Bài đã đăng hiện ở trang `tin-tuc.html`, chậm tối đa 5 phút do có bộ nhớ đệm, trừ khi bạn vừa lưu.
4. Bảo mật:
   - Sai mật khẩu 5 lần thì bị khóa 15 phút.
   - Phiên đăng nhập hết hạn sau 6 giờ, và đóng tab là phải đăng nhập lại.
   - Trang admin không được Google lập chỉ mục.
   - Ai có quyền sửa Google Sheet thì cũng sửa được bài viết trực tiếp trong sheet "Bai viet", vì vậy chỉ chia sẻ Sheet cho người tin cậy.
   - Ảnh trong bài: dán link ảnh `https://…`. Trang chưa hỗ trợ tải ảnh lên trực tiếp.

## 2. Đưa web lên mạng (miễn phí)
**Cách nhanh nhất: Netlify Drop**
1. Vào https://app.netlify.com/drop và đăng nhập.
2. Kéo cả thư mục `Web_BĐS` vào trang. Thư mục `.cache/` không cần, nên xóa hoặc bỏ ra trước khi kéo cho nhẹ.
3. Netlify cấp một tên miền dạng `ten-ngau-nhien.netlify.app`. Có thể đổi tên hoặc gắn tên miền riêng trong *Domain settings*.

**Cách khác:** GitHub Pages hoặc Cloudflare Pages. Đẩy thư mục lên một repo; `.gitignore` đã loại sẵn `.cache/`.

Dung lượng hiện tại khoảng 45MB, nằm trong giới hạn miễn phí của các dịch vụ trên.

## 3. Cập nhật dữ liệu dự án
```
python -I build.py --site https://tenmien-cua-ban.vn
```
- Lệnh này lấy lại danh sách và chi tiết dự án, tải ảnh mới, đồng thời tạo `sitemap.xml` và `robots.txt` cho Google.
- Thêm `--refresh` để tải lại toàn bộ dữ liệu thay vì chỉ phần còn thiếu.
- Sau khi chạy, đưa thư mục lên lại hosting (Netlify: kéo thả lại).

## 4. Sau khi lên mạng
- Khai báo `sitemap.xml` trong Google Search Console.
- Nhờ người có chuyên môn pháp lý rà soát `chinh-sach-bao-mat.html` (đang là bản mẫu theo Nghị định 13/2023/NĐ-CP).
- Chỉ đăng thông tin và hình ảnh của dự án mà bạn được quyền phân phối.
