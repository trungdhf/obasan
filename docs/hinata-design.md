# Hinata – tóm tắt thiết kế

Oct 4, 2026 · @Trung

## Ý tưởng

Hinata là bé gái hoạt hình trên tablet, trò chuyện bằng giọng nói với người cao tuổi sống một mình ở Nhật. Bé chủ động hỏi thăm, nhắc uống thuốc và uống nước, và báo con cháu qua LINE khi có dấu hiệu bất thường. Đây là agent tự quyết định khi nào nói, khi nào nghỉ, khi nào báo gia đình, không phải chatbot chờ hỏi.

## Tính năng chính

- **Trò chuyện realtime:** Gemini 3.8 Live, tiếng Nhật thân mật kiểu trẻ con.
- **Avatar 7 biểu cảm:** bình thường, vui, buồn, lo lắng, hờn, sợ hãi, ngạc nhiên; nhép miệng theo giọng, chớp mắt, ngủ khi chờ. Gemini đổi biểu cảm qua tool `set_emotion`. File avatar: `hinata-avatar.svg`.
- **Tự chuyển chế độ chờ:** MediaPipe nhận diện khuôn mặt trên tablet; vắng 30–60 giây thì đóng phiên Live và ngủ, có người thì thức dậy chào.
- **Chủ động gọi:** theo lịch (thuốc, bữa ăn), theo sự kiện (cảnh báo say nắng), hoặc chuyển lời nhắn LINE của gia đình. Câu gọi dùng Gemini 3.8 Flash TTS tạo sẵn.
- **Báo gia đình:** gọi 3 lần trong 15 phút không phản hồi thì gửi LINE cho con cháu; con người quyết định bước tiếp.
- **Nhớ câu chuyện:** lưu tóm tắt hội thoại để lần sau nói tiếp.

## Kiến trúc

| Thành phần | Vai trò |
| --- | --- |
| Tablet (web app, Android Chrome kiosk) | Avatar, MediaPipe, kết nối Gemini Live, Wake Lock |
| Cloud Run | Backend agent (ADK), logic gọi và báo gia đình, webhook LINE |
| Gemini 3.8 Live / Flash TTS | Hội thoại realtime / câu gọi tạo sẵn |
| Firestore | Tóm tắt hội thoại, lịch nhắc, nhật ký agent |
| Cloud Scheduler | Kích hoạt lần gọi theo lịch |
| LINE Messaging API | Nhận lời nhắn, gửi cảnh báo cho gia đình |
| Secret Manager | Token LINE, khóa API |

Tool của agent: `set_emotion`, `notify_family`, `schedule_reminder`, `get_weather_alert`, `save_memory`.

## An toàn, chi phí, nộp bài

**An toàn:** hình camera chỉ xử lý trên tablet; con người xác nhận trước hành động quan trọng; nhật ký agent; giờ yên tĩnh ban đêm; lời nhắn LINE coi là dữ liệu, không phải lệnh; không thu thập My Number.

**Chi phí:** Gemini Live khoảng $0.005/phút vào và $0.018/phút ra (giá tra cứu ngày 4/10/2026). 30 phút mỗi ngày ước khoảng 2.000 yên/tháng mỗi người; chế độ chờ và avatar chạy trên tablet giúp giữ chi phí thấp.

**Nộp bài trước 15/10/2026:** GitHub, URL deploy trên Google Cloud, sơ đồ kiến trúc, video demo khoảng 3 phút.

- [x] Demo avatar: biểu cảm, nhép miệng, chế độ chờ, chủ động gọi
- [ ] Nối Gemini Live thật
- [ ] MediaPipe nhận diện khuôn mặt
- [ ] LINE bot cho gia đình
- [ ] Backend Cloud Run + Firestore + Scheduler, deploy
- [ ] Quay video demo
