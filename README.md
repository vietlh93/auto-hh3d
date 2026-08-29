# HH3D Auto Tool

Chrome Extension tự động hóa các tác vụ hằng ngày trên website `hoathinh3d.*`.
Extension tự nhận diện domain đang hoạt động, tự inject script vào tab, lưu cấu hình worker và resume khi tab reload.

> Dự án dùng cho mục đích cá nhân. Hãy sử dụng có trách nhiệm và tuân thủ quy định của website.

## Tính năng chính

### Worker tự động

| Worker | Mô tả |
| --- | --- |
| 🎁 Phúc Lợi Đường | Tự mở rương theo thời gian |
| 🛡️ Boss Hoang Vực | Tự đánh boss Hoang Vực |
| 👹 Boss Tông Môn | Tự đánh boss Tông Môn |
| 🎡 Vòng Quay Phúc Vận | Tự quay và kiểm tra lượt quay |
| 💎 Thí Luyện Tông Môn | Tự xử lý TLTM |
| ❓ Vấn Đáp Tông Môn | Tự trả lời câu hỏi từ `answers.json` |
| 🙏 Tế Lễ Tông Môn | Tự tế lễ khi còn lượt |
| 🏆 Thưởng Ngày | Tự nhận thưởng hoạt động ngày |
| ⛏️ Khoáng Mạch | Tự chọn mỏ, vào mỏ và nhận thưởng |
| 🧪 Luyện Đan | Tự luyện đan và điều hỏa |
| ⚔️ Mê Cung | Tự lập/vào phòng, chiến đấu và nhận rương |

### Hệ thống

- 🌐 Auto-detect domain `hoathinh3d.*`, không cần sửa URL khi website đổi đuôi.
- 💉 Dynamic injection qua Manifest V3 và `chrome.scripting`.
- 🔄 Auto-resume worker sau khi refresh tab hoặc restart extension.
- ✅ Lưu trạng thái hoàn thành theo ngày bằng `chrome.storage.local`.
- ⏭️ Tự bỏ qua worker đã hoàn thành trong ngày.
- 💓 Heartbeat theo dõi kết nối content script/background.
- 🔐 Tự fetch nonce, token và action từ trang hiện tại.
- ⏱️ Request queue tuần tự, delay tối thiểu 6 giây giữa request.
- 🔁 Retry khi gặp lỗi mạng, HTTP 429 hoặc HTTP 503.
- 📋 Log realtime trong popup.

## Cài đặt

1. Tải hoặc clone repository này.
2. Mở Chrome và truy cập:

   ```text
   chrome://extensions/
   ```

3. Bật **Developer mode**.
4. Chọn **Load unpacked**.
5. Chọn thư mục extension chứa `manifest.json`.
6. Truy cập `hoathinh3d.*` và đăng nhập tài khoản.

## Sử dụng

1. Mở website `hoathinh3d.*` đang hoạt động.
2. Đăng nhập tài khoản.
3. Click icon **HH3D Auto Tool** trên thanh công cụ Chrome.
4. Kiểm tra domain hiển thị trong popup.
5. Tick worker muốn chạy hoặc chọn **Tất cả**.
6. Với **Khoáng Mạch**:
   - Chọn loại mỏ.
   - Bấm **Check**.
   - Chọn mỏ cụ thể.
7. Với **Mê Cung**:
   - Chọn số người tối thiểu.
   - Chọn vai trò **Chủ Phòng** hoặc **Thành Viên**.
8. Bấm **Bắt đầu**.
9. Theo dõi log trong popup.
10. Bấm **Dừng lại** khi muốn dừng toàn bộ worker.

## Cấu trúc thư mục

```text
extention/
├── manifest.json          # Manifest V3
├── background.js          # Service worker, quản lý tab và inject script
├── content.js             # Logic worker chính
├── inject.js              # Bridge đọc dữ liệu từ page context
├── popup.html             # Giao diện popup
├── popup.css              # Style popup
├── popup.js               # Logic popup
├── luyen-dan.js           # Logic liên quan Luyện Đan
├── answers.json           # Dữ liệu đáp án Vấn Đáp
├── icons/                 # Icon extension
├── *.txt                  # Ghi chú/phân tích endpoint, page source
└── README.md              # Tài liệu dự án
```

## Quyền Chrome Extension

Extension dùng các quyền sau:

| Permission | Mục đích |
| --- | --- |
| `storage` | Lưu cấu hình, trạng thái worker, trạng thái hoàn thành theo ngày |
| `tabs` | Tìm tab `hoathinh3d.*` đang mở |
| `alarms` | Hỗ trợ tác vụ nền |
| `activeTab` | Tương tác tab hiện tại |
| `scripting` | Inject content script động |
| `<all_urls>` | Tự phát hiện mọi domain `hoathinh3d.*` khi website đổi đuôi |

## Bảo mật

- Extension không gửi cookie, token hay dữ liệu tài khoản đến server bên thứ ba.
- Request chỉ chạy trên domain `hoathinh3d.*` đang mở.
- Dữ liệu trạng thái chỉ lưu cục bộ trong `chrome.storage.local`.
- Có thể kiểm tra toàn bộ mã nguồn trước khi cài đặt.

## Lưu ý vận hành

- Cần đăng nhập website trước khi chạy extension.
- Không đóng tab website nếu muốn worker tiếp tục chạy ổn định.
- Popup có thể đóng, worker vẫn chạy trong content script.
- Worker đã hoàn thành trong ngày sẽ được đánh dấu và bỏ qua khi resume.
- Khi hết lượt trong ngày, worker có thể chờ đến 0h hoặc dừng tùy logic từng tác vụ.
- Nếu website thay đổi endpoint hoặc token, cần cập nhật logic fetch nonce/action.

## Debug

Nếu extension không chạy đúng:

1. Kiểm tra popup có nhận đúng domain không.
2. Refresh tab `hoathinh3d.*`.
3. Mở `chrome://extensions/`.
4. Chọn extension **HH3D Auto Tool**.
5. Mở **Service worker** để xem log background.
6. Mở DevTools trên tab website để xem log content script.
7. Bấm reload extension nếu context bị mất.
8. Đăng nhập lại nếu log báo phiên hết hạn.

## Changelog

### v1.1.0

- Thêm auto-detect domain `hoathinh3d.*`.
- Thêm dynamic content script injection.
- Thêm request queue tuần tự, giảm lỗi spam request.
- Thêm retry với jitter cho lỗi 429, 503 và lỗi mạng.
- Thêm auto-resume worker khi reload tab.
- Thêm daily completion tracking theo ngày.
- Thêm skip worker đã hoàn thành trong ngày.
- Bổ sung worker Khoáng Mạch, Luyện Đan và Mê Cung.

### v1.0.0

- Chuyển logic tự động hóa sang Chrome Extension.
- Thêm popup điều khiển worker.
- Thêm log realtime.
- Thêm heartbeat và cơ chế resume cơ bản.

## Disclaimer

Dự án không liên kết với website `hoathinh3d` hoặc bất kỳ bên thứ ba nào.
Người dùng tự chịu trách nhiệm khi sử dụng extension.
