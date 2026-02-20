# HH3D Auto Tool - Chrome Extension

## 🐉 Giới thiệu

Extension tự động hóa các tác vụ hàng ngày trên **hoathinh3d** (tự động nhận diện domain, hỗ trợ mọi đuôi `.gg`, `.bz`, `.li`, `.to`,...).

## ✨ Tính năng

### Workers
- 🎁 **Phúc Lợi Đường** - Tự động mở rương theo thời gian
- 🛡️ **Boss Hoang Vực** - Tự động đánh boss hoang vực
- 👹 **Boss Tông Môn** - Tự động attack boss tông môn
- 🎡 **Vòng Quay** - Tự động spin vòng quay phúc vận
- 💎 **TLTM** - Thí Luyện Tông Môn
- ⚔️ **Luận Võ** - Tự động tham gia và thách đấu
- ❓ **Vấn Đáp** - Tự động trả lời câu hỏi (đáp án từ `answers.json`)
- 🙏 **Tế Lễ** - Tự động tế lễ tông môn
- 🏆 **Thưởng Ngày** - Tự động nhận thưởng hoạt động ngày
- ⛏️ **Khoáng Mạch** - Tự động vào mỏ và claim thưởng (chọn loại mỏ: Vàng/Bạc/Đồng)

### Hệ thống
- 🌐 **Auto-detect domain** - Tự động nhận diện `hoathinh3d.*` bất kỳ đuôi nào
- 💉 **Dynamic injection** - Tự inject content script vào tab, không cần hardcode URL
- 🔄 **Auto-resume** - Tự động resume workers khi refresh tab hoặc restart extension
- 💓 **Heartbeat** - Kiểm tra kết nối liên tục, tự phục hồi khi mất kết nối
- 🔐 **Nonce tự động** - Tự fetch nonces từ các trang thay vì hardcode
- 📋 **Logs** - Hiển thị log realtime trong popup
- ⏱️ **Request queue** - Hàng đợi tuần tự, tránh spam server (delay 6s giữa các request)

## 📦 Cài đặt

### Bước 1: Tải extension
1. Tải toàn bộ thư mục `extention` về máy

### Bước 2: Cài vào Chrome
1. Mở Chrome, truy cập `chrome://extensions/`
2. Bật **Developer mode** (góc phải trên)
3. Click **Load unpacked**
4. Chọn thư mục `extention`

### Bước 3: Sử dụng
1. Truy cập **hoathinh3d** (bất kỳ đuôi nào đang hoạt động)
2. Đăng nhập tài khoản của bạn
3. Extension sẽ **tự động phát hiện** domain và inject script

## 🚀 Sử dụng

1. Click icon extension 🐉 trên thanh công cụ Chrome
2. Kiểm tra domain đã được phát hiện (hiển thị ở header 🌐)
3. Tick chọn các worker muốn chạy (hoặc chọn **Tất cả**)
4. Nếu muốn đào mỏ: chọn loại mỏ → bấm **Check** → chọn mỏ cụ thể
5. Nhấn **Bắt đầu** để chạy
6. Xem logs realtime để theo dõi tiến trình
7. Nhấn **Dừng lại** khi muốn dừng

## ⚙️ Lưu ý

- Extension tự nhận diện domain `hoathinh3d.*` → **không cần cập nhật khi đổi đuôi**
- Phải đăng nhập trên web trước khi sử dụng
- Có delay tối thiểu **6 giây** giữa các request (request queue tuần tự)
- Workers tự chờ đến **0h** nếu hết lượt trong ngày
- Extension chạy ngầm ngay cả khi popup đóng
- Tự resume workers khi tab bị refresh
- Retry tự động khi gặp lỗi 503, 429, hoặc lỗi mạng (tối đa 5 lần)

## 🔒 Bảo mật

- Extension KHÔNG gửi cookie/dữ liệu đến bất kỳ server bên thứ ba nào
- Mọi request chỉ gửi đến domain `hoathinh3d` hiện tại
- Sử dụng `<all_urls>` permission để hỗ trợ auto-detect domain
- Mã nguồn mở, có thể kiểm tra

## 📁 Cấu trúc

```
extention/
├── manifest.json      # Manifest V3, auto-detect domain
├── background.js      # Service worker, quản lý tab & inject script
├── content.js         # Logic chính, chạy trong context trang web
├── popup.html         # Giao diện popup
├── popup.js           # Logic popup
├── popup.css          # Style popup (dark theme)
├── answers.json       # Đáp án cho worker Vấn Đáp
├── icons/             # Icon extension
└── README.md          # File này
```

## 🐛 Debug

Nếu gặp lỗi:
1. Kiểm tra domain indicator trên popup (🌐) có hiển thị đúng domain không
2. Mở DevTools của extension: `chrome://extensions/` → click **"Service worker"**
3. Xem console logs để biết chi tiết lỗi
4. Thử refresh tab hoathinh3d (extension sẽ tự re-inject và resume)
5. Nếu vẫn lỗi: reload extension từ `chrome://extensions/`

## 📝 Changelog

**v1.1.0** - Auto-detect domain + Request queue
- 🌐 Tự động nhận diện domain `hoathinh3d.*` (bất kỳ TLD)
- 💉 Dynamic content script injection (không cần hardcode URL trong manifest)
- ⏱️ Request queue tuần tự, fix race condition gây 503
- 🔀 Random jitter cho retry delay, tránh thundering herd
- 🏷️ Hiển thị domain đang phát hiện trên popup

**v1.0.0** - Phiên bản đầu tiên
- Chuyển đổi từ Node.js script sang Chrome Extension
- Content script chạy trực tiếp trong context trang web
- Giao diện popup hiện đại (dark theme)
- 10 workers: Phúc Lợi, Boss HV, Boss TM, Quay, TLTM, Luận Võ, Vấn Đáp, Tế Lễ, Thưởng Ngày, Khoáng Mạch
- Heartbeat mechanism + auto-resume
