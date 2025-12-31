# HH3D Auto Tool - Chrome Extension

## 🐉 Giới thiệu

Extension tự động hóa các tác vụ hàng ngày trên **hoathinh3d.gg**, sử dụng cookie trực tiếp từ trình duyệt.

## ✨ Tính năng

- 🎁 **Phúc Lợi Đường** - Tự động mở rương theo thời gian
- 🛡️ **Boss Hoang Vực** - Tự động đánh boss
- ⚔️ **Boss Tông Môn** - Tự động attack boss tông môn
- 🎡 **Vòng Quay** - Tự động spin
- 💎 **TLTM** - Thí Luyện Tông Môn
- ⚔️ **Luận Võ** - Tự động tham gia và thách đấu
- ❓ **Vấn Đáp** - Tự động trả lời câu hỏi
- 🙏 **Tế Lễ** - Tự động tế lễ tông môn
- 📅 **Điểm danh** - Tự động điểm danh hàng ngày

## 📦 Cài đặt

### Bước 1: Tải extension
1. Tải toàn bộ thư mục `extension` về máy

### Bước 2: Cài vào Chrome
1. Mở Chrome, truy cập `chrome://extensions/`
2. Bật **Developer mode** (góc phải trên)
3. Click **Load unpacked**
4. Chọn thư mục `extension`

### Bước 3: Đăng nhập website
1. Truy cập **hoathinh3d.gg**
2. Đăng nhập tài khoản của bạn
3. Click icon extension và nhấn **Kiểm tra Cookie** để xác nhận

## 🚀 Sử dụng

1. Click icon extension trên thanh công cụ Chrome
2. Tick chọn các worker muốn chạy
3. Nhấn **Bắt đầu** để bắt đầu tự động hóa
4. Xem logs để theo dõi tiến trình
5. Nhấn **Dừng lại** khi muốn dừng

## ⚙️ Lưu ý

- Extension cần quyền truy cập cookie của hoathinh3d.gg
- Phải đăng nhập trước khi sử dụng
- Có delay tối thiểu 5 giây giữa các request để tránh spam
- Workers sẽ tự động chờ đến 0h nếu hết lượt trong ngày
- Extension chạy ngầm ngay cả khi popup đóng

## 🔒 Bảo mật

- Extension KHÔNG gửi cookie/dữ liệu đến bất kỳ server nào khác
- Mọi request chỉ gửi đến hoathinh3d.gg
- Mã nguồn mở, có thể kiểm tra

## 🐛 Debug

Nếu gặp lỗi:
1. Mở DevTools của extension (click "Service worker" trong trang extensions)
2. Xem console logs để biết chi tiết lỗi
3. Thử reload extension và kiểm tra cookie lại

## 📝 Version

**v1.0.0** - Phiên bản đầu tiên
- Chuyển đổi từ Node.js script
- Sử dụng Chrome cookies API
- Giao diện popup hiện đại
