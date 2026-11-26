# HH3D Auto Tool

Chrome Extension tự động hóa các tác vụ hằng ngày trên website `hoathinh3d.*`.
Extension tự nhận diện domain đang hoạt động, mở giao diện dưới dạng Side Panel trên tab `hoathinh3d.*`, tự inject script vào tab, lưu cấu hình worker và tự động resume khi tab reload.

> Dự án dùng cho mục đích cá nhân. Hãy sử dụng có trách nhiệm và tuân thủ quy định của website.

## Tính năng chính

### Worker tự động

| Worker | Mô tả |
| --- | --- |
| 🎁 Phúc Lợi Đường | Tự mở rương theo thời gian và nhận rương mốc khi đủ điểm |
| 🛡️ Boss Hoang Vực | Tự đánh boss Hoang Vực, tự đổi Ngũ Hành miễn phí khi khắc chế chưa đạt và nhận thưởng boss cũ |
| 👹 Boss Tông Môn | Tự đánh boss Tông Môn và tự nhận thưởng khi có thưởng chờ |
| 🎡 Vòng Quay Phúc Vận | Tự quay và tự đánh thức kiểm tra lại lượt quay ngay khi nhận Mốc 2 |
| 💎 Thí Luyện Tông Môn | Tự kiểm tra thời gian và mở rương TLTM |
| ❓ Vấn Đáp Tông Môn | Tự trả lời câu hỏi dựa trên dữ liệu đã chuẩn hóa từ `answers.json` |
| 🙏 Tế Lễ Tông Môn | Tự kiểm tra trạng thái và tế lễ khi còn lượt |
| 🏆 Thưởng Ngày | Tự nhận thưởng hoạt động ngày (stage1, stage2) |
| ⛏️ Khoáng Mạch | Tự nhận thưởng tồn đọng, chọn/vào mỏ và claim thưởng theo chu kỳ (15/30/90 phút tùy loại mỏ) |
| 🧪 Luyện Đan | Tự chọn phẩm, Điều Hỏa khi độ ổn định tụt, mở gói linh dược, thu & dùng đan và tự phân giải khi túi đầy |
| ⚔️ Mê Cung | Tự lập/vào phòng theo số người min và vai trò, chiến đấu, nhận rương và dừng khi đạt Max Tinh Thạch |

### Hệ thống

- 🌐 Auto-detect domain `hoathinh3d.*`, không cần sửa URL khi website đổi đuôi.
- 🧭 Giao diện Side Panel (`chrome.sidePanel`), tự bật và ghim trên các tab `hoathinh3d.*`.
- 💉 Dynamic injection (`inject.js` vào `MAIN` world và `content.js`) qua Manifest V3 và `chrome.scripting`.
- 🔒 Khóa chạy một tab duy nhất (`activeTabId` / `activeTabInstanceId`), tự dừng tab cũ khi khởi động từ tab khác để tránh bắn API trùng lặp.
- 🔄 Auto-resume worker sau khi refresh tab hoặc restart extension, chống race condition khi service worker khởi động lại.
- 🌅 Tự phát hiện qua ngày mới, reset log và trạng thái hoàn thành hằng ngày (`dailyCompletion`).
- ✅ Lưu trạng thái hoàn thành theo ngày bằng `chrome.storage.local` và tự bỏ qua worker đã xong trong ngày.
- 💓 Heartbeat và keep-alive alarm tối ưu (30 giây khi đang chạy, 5 phút khi nghỉ).
- 🔐 Tự fetch nonce, token và giải mã action từ trang hiện tại.
- ⏱️ Request queue tuần tự có mức ưu tiên, giới hạn timeout 30 giây, hủy sạch hàng đợi/request khi bấm Dừng.
- 🔁 Retry với jitter khi gặp lỗi mạng, timeout, HTTP 429 hoặc HTTP 503.
- 📋 Log realtime trong Side Panel kèm bộ lọc (`Tất cả`, `Lỗi`, `OK`), nút `Copy`, `Xóa` và nút `🔄 Reset` ngày.

## Cài đặt

1. Tải hoặc clone repository này.
2. Mở Chrome và truy cập:

   ```text
   chrome://extensions/
   ```

3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Chọn thư mục `extention/` chứa `manifest.json`.
6. Truy cập `hoathinh3d.*` và đăng nhập tài khoản.

## Sử dụng

1. Mở website `hoathinh3d.*` đang hoạt động và đăng nhập tài khoản.
2. Click icon **HH3D Auto Tool** trên thanh công cụ Chrome để mở **Side Panel**.
3. Kiểm tra domain hiển thị ở phần đầu giao diện.
4. Tick các worker muốn chạy hoặc chọn **Tất cả**. Có thể bấm **🔄 Reset** nếu muốn chạy lại toàn bộ worker đã đánh dấu xong trong ngày.
5. Với **Khoáng Mạch**:
   - Chọn loại mỏ (Thượng / Trung / Hạ).
   - Bấm **🔍 Check** để tải danh sách mỏ hiện tại.
   - Chọn mỏ cụ thể.
6. Với **Luyện Đan**:
   - Chọn phẩm luyện (`Tự động chọn cao nhất` hoặc phẩm cụ thể).
   - Tùy chọn bật **Tự phân giải khi túi đầy**, sau đó chọn phẩm và số sao phân giải.
7. Với **Mê Cung**:
   - Chọn số người tối thiểu (1–5).
   - Chọn vai trò **Chủ Phòng** hoặc **Thành Viên**.
   - Tùy chọn nhập **Max Tinh Thạch** (bỏ trống để tự nhận diện theo VIP).
8. Bấm **▶️ Bắt đầu**.
9. Theo dõi log realtime (có thể lọc theo `Tất cả` / `Lỗi` / `OK`, bấm `Copy` hoặc `Xóa`).
10. Bấm **⏹️ Dừng lại** khi muốn dừng toàn bộ worker và hủy các request đang chờ.

## Cấu trúc thư mục

```text
extention/
├── manifest.json          # Manifest V3
├── background.js          # Service worker, quản lý Side Panel, tab lock và inject script
├── content.js             # Logic worker chính và HTTP client
├── inject.js              # Bridge an toàn trong MAIN world (allowlist command)
├── popup.html             # Giao diện Side Panel
├── popup.css              # Style Side Panel
├── popup.js               # Logic giao diện, cấu hình và log
├── answers.json           # Dữ liệu đáp án Vấn Đáp
├── icons/                 # Icon extension (16, 48, 128)
└── README.md              # Tài liệu dự án
```

## Quyền Chrome Extension

Extension dùng các quyền sau trong `manifest.json`:

| Permission | Mục đích |
| --- | --- |
| `storage` | Lưu cấu hình worker, log, domain phát hiện và trạng thái hoàn thành theo ngày |
| `tabs` | Tìm, theo dõi và đồng bộ tab `hoathinh3d.*` đang mở |
| `alarms` | Duy trì keep-alive alarm và kiểm tra reset sang ngày mới |
| `scripting` | Inject `inject.js` (`MAIN` world) và `content.js` động |
| `sidePanel` | Hiển thị giao diện điều khiển dưới dạng Side Panel trên tab `hoathinh3d.*` |
| `<all_urls>` | Tự phát hiện mọi domain `hoathinh3d.*` khi website đổi đuôi |

## Bảo mật

- Extension không gửi cookie, token hay dữ liệu tài khoản đến server bên thứ ba.
- Request chỉ chạy trên domain `hoathinh3d.*` đang mở.
- Dữ liệu trạng thái chỉ lưu cục bộ trong `chrome.storage.local`.
- Bridge giữa `content.js` và `inject.js` (`postMessage`) kiểm tra chặt `e.source === window` và `e.origin === window.location.origin`, không sử dụng `eval` hay `new Function`, và chỉ cho phép các lệnh cố định trong allowlist (`readHh3dData`, `mcGetGlobals`, `mcCall`).
- `web_accessible_resources` chỉ mở `answers.json`, không expose `inject.js`.

## Lưu ý vận hành

- Cần đăng nhập website trước khi chạy extension.
- Không đóng tab website đang chạy nếu muốn worker tiếp tục hoạt động ổn định.
- Side Panel có thể đóng, worker vẫn chạy trong content script của tab đang giữ quyền.
- Chỉ một tab `hoathinh3d.*` chạy worker tại một thời điểm; bấm Bắt đầu ở tab mới sẽ tự dừng tab cũ.
- Worker đã hoàn thành trong ngày sẽ được đánh dấu và bỏ qua khi resume (trừ Vòng Quay vẫn kiểm tra lại khi nhận Mốc 2).
- Khi hết lượt trong ngày, worker có thể chờ đến 0h hoặc dừng tùy logic từng tác vụ.
- Nếu website thay đổi endpoint hoặc token, cần cập nhật logic fetch nonce/action.

## Debug

Nếu extension không chạy đúng:

1. Kiểm tra Side Panel có nhận đúng domain không.
2. Refresh tab `hoathinh3d.*`.
3. Mở `chrome://extensions/`.
4. Chọn extension **HH3D Auto Tool**.
5. Mở **Service worker** để xem log background.
6. Mở DevTools trên tab website để xem log content script.
7. Bấm reload extension nếu context bị mất.
8. Đăng nhập lại nếu log báo phiên hết hạn.

## Changelog

### v1.1.0

- Chuyển giao diện sang Side Panel (`sidePanel`) chỉ bật trên tab `hoathinh3d.*`, bổ sung bộ lọc log, Copy log và nút Reset ngày.
- Thêm auto-detect domain `hoathinh3d.*` và dynamic injection qua `chrome.scripting`.
- Khóa chạy 1 tab duy nhất (`activeTabId` / `activeTabInstanceId`) và xử lý chống race condition khi service worker tỉnh dậy.
- Thêm request queue tuần tự có mức ưu tiên, timeout 30 giây, hủy sạch hàng đợi/request khi Stop và retry với jitter cho lỗi 429, 503, lỗi mạng.
- Siết bảo mật `inject.js` với `postMessage` bridge có allowlist và kiểm tra `origin`/`source` (loại bỏ `new Function`), bỏ quyền `activeTab` dư thừa và bỏ `inject.js` khỏi `web_accessible_resources`.
- Tối ưu keep-alive alarm (30s khi chạy / 5 phút khi nghỉ), đánh thức Vòng Quay tức thì khi nhận Mốc 2, pre-normalize dữ liệu Vấn Đáp và dọn các file tham khảo khỏi gói extension.
- Thêm auto-resume khi reload tab, daily completion tracking, tự reset khi qua ngày mới và skip worker đã hoàn thành trong ngày.
- Bổ sung/nâng cấp worker Khoáng Mạch, Luyện Đan (kèm tự phân giải), Mê Cung (kèm Max Tinh Thạch), Phúc Lợi (nhận rương mốc), Boss Hoang Vực (đổi Ngũ Hành miễn phí) và Boss Tông Môn (tự nhận thưởng).

### v1.0.0

- Chuyển logic tự động hóa sang Chrome Extension.
- Thêm popup điều khiển worker.
- Thêm log realtime.
- Thêm heartbeat và cơ chế resume cơ bản.

## Disclaimer

Dự án không liên kết với website `hoathinh3d` hoặc bất kỳ bên thứ ba nào.
Người dùng tự chịu trách nhiệm khi sử dụng extension.