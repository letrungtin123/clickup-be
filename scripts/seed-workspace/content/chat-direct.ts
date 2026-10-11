import type { ChatScene } from "../types.js";

/**
 * Direct conversations: 1:1 DMs and group DMs (INVENTED content, local seed only).
 * Only the participants of each conversation speak, react or get mentioned.
 */
export const scenesDirect: ChatScene[] = [
  // ─────────────────────────────── boss ↔ linh ───────────────────────────────
  {
    where: { dm: ["boss", "linh"] },
    date: "2026-08-25",
    time: "08:15",
    lines: [
      { by: "linh", text: "Anh ơi, em dựng xong workspace với các dự án chính rồi ạ. Anh vào xem thử bố cục giúp em nhé." },
      { by: "boss", gap: 7, text: "Ok em, để anh xem. Kênh thông báo em để trống, 9h anh đăng bài mở màn nha." },
      { by: "linh", gap: 2, text: "Dạ em để sẵn rồi ạ. Em có soạn thêm hướng dẫn sử dụng ngắn, anh muốn đính kèm luôn không ạ?" },
      { by: "boss", gap: 3, text: "Có, đính kèm luôn. Chuẩn bị kỹ ghê 👍", react: { "❤️": ["linh"] } }
    ]
  },
  {
    where: { dm: ["boss", "linh"] },
    date: "2026-09-15",
    time: "21:10",
    lines: [
      { by: "boss", text: "Tình hình đơn Úc hôm nay sao rồi em?" },
      { by: "linh", gap: 4, text: "Dạ hôm nay về khoảng 1.180 ảnh, ca đêm đang chạy 2 job gấp. QC hơi đuối, em đã bàn với Khoa cho thêm 2 bạn QC tăng ca tối ạ." },
      { by: "boss", gap: 3, text: "Ok. Tăng ca thì ghi nhận đầy đủ cho anh em. Hết đợt này anh mời cả team đi ăn." },
      { by: "linh", gap: 1, text: "Dạ em cảm ơn anh, em báo mọi người liền ạ 🙏", react: { "❤️": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "linh"] },
    date: "2026-09-23",
    time: "08:05",
    lines: [
      { by: "boss", text: "Chúc mừng sinh nhật em! Cảm ơn em đã gánh phần vận hành suốt thời gian qua. Tuổi mới nhiều sức khoẻ nhé 🎂", react: { "❤️": ["linh"] } },
      { by: "linh", gap: 6, text: "Dạ em cảm ơn anh nhiều ạ 🥰 Quý 4 team mình sẽ cố gắng hơn nữa ạ!" }
    ]
  },
  {
    where: { dm: ["boss", "linh"] },
    date: "2026-10-05",
    time: "17:30",
    lines: [
      {
        by: "linh",
        text: "Anh ơi, em gửi bản kế hoạch vận hành Q4. Có 3 mục cần anh quyết:\n\n1. Tuyển 6 retoucher, chia 2 đợt\n2. Ca đêm cố định 2 tối/tuần cho khách Úc\n3. Thưởng năng suất theo quý thay vì theo tháng",
        files: [{ name: "ke-hoach-van-hanh-Q4.pdf", hint: "kế hoạch vận hành quý 4: nhân sự, ca làm, chỉ tiêu sản lượng" }]
      },
      { by: "boss", gap: 25, text: "Mục 1 anh đồng ý. Mục 2 làm thử 1 tháng rồi đánh giá. Mục 3 tuần sau anh bàn thêm với em và kế toán." },
      { by: "linh", gap: 2, text: "Dạ em rõ ạ. Em cập nhật lại kế hoạch và gửi mọi người sáng mai.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "linh"] },
    date: "2026-10-10",
    time: "15:20",
    lines: [
      {
        by: "linh",
        text: "Anh ơi, em xin anh duyệt giúp 2 việc trước sáng thứ 2 ạ:\n\n1. Offer cho 3 bạn retoucher đợt 1\n2. Ngân sách quà 20/10 cho các chị em trong công ty",
        edited: "Anh ơi, em xin anh duyệt giúp 2 việc trước sáng thứ 2 ạ:\n\n1. Offer cho 3 bạn retoucher đợt 1 (đã qua bài test và phỏng vấn)\n2. Ngân sách quà 20/10 cho các chị em trong công ty",
        files: [{ name: "de-xuat-offer-va-qua-20-10.pdf", hint: "đề xuất offer 3 retoucher đợt 1 và kế hoạch quà 20/10" }]
      },
      { by: "linh", gap: 45, text: "Anh xem giúp em khi rảnh nha, em cần báo các bạn trước thứ 2 để kịp nhận việc ngày 19/10 ạ 🙏" }
    ]
  },

  // ─────────────────────────────── boss ↔ admin ───────────────────────────────
  {
    where: { dm: ["boss", "admin"] },
    date: "2026-08-26",
    time: "10:00",
    lines: [
      { by: "admin", text: "Dạ anh, em đã tạo tài khoản Nesso Work cho cả công ty rồi ạ. Còn 2 bạn ca đêm chưa đăng nhập lần nào." },
      { by: "boss", gap: 5, text: "Ok em. Nhắc các bạn đăng nhập trong tuần này nhé, ai quên mật khẩu thì em đặt lại giúp." },
      { by: "admin", gap: 1, text: "Dạ vâng ạ, tối nay em nhắn trực tiếp cho 2 bạn đó.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "admin"] },
    date: "2026-09-11",
    time: "13:45",
    lines: [
      { by: "admin", text: "Anh ơi, 16h chiều nay mình tiễn Lộc ạ. Em đã đặt bánh và quà lưu niệm. Anh có muốn nói vài lời không ạ?" },
      { by: "boss", gap: 8, text: "Có, anh nói ngắn thôi. Em in giúp anh thư cảm ơn để anh ký tặng Lộc nhé." },
      {
        by: "admin",
        gap: 20,
        text: "Dạ em soạn xong rồi, anh xem giúp em nội dung ạ.",
        files: [{ name: "thu-cam-on-Loc.pdf", hint: "thư cảm ơn nhân viên nghỉ việc, có chỗ ký của giám đốc" }]
      },
      { by: "boss", gap: 4, text: "Ổn rồi em. Thêm 1 câu: công ty luôn chào đón Lộc quay lại.", react: { "✅": ["admin"] } }
    ]
  },
  {
    where: { dm: ["boss", "admin"] },
    date: "2026-09-25",
    time: "11:15",
    lines: [
      {
        by: "admin",
        text: "Dạ bánh trung thu về đủ rồi anh ạ, 16h30 mình phát cho mọi người nhé.",
        files: [{ name: "banh-trung-thu.jpg", hint: "các hộp bánh trung thu xếp ngay ngắn trên bàn văn phòng" }]
      },
      { by: "boss", gap: 6, text: "Đẹp đó 👍 Em để riêng mấy hộp gửi anh bảo vệ với cô tạp vụ nha.", react: { "🙏": ["admin"] } },
      { by: "admin", gap: 1, text: "Dạ em nhớ rồi ạ." }
    ]
  },
  {
    where: { dm: ["boss", "admin"] },
    date: "2026-10-02",
    time: "09:20",
    lines: [
      {
        by: "admin",
        text: "Anh ơi, em gửi báo cáo nhân sự Q3 ạ: biến động nhân sự, đào tạo và chi phí phúc lợi.",
        files: [{ name: "bao-cao-nhan-su-Q3.pdf", hint: "báo cáo nhân sự quý 3: biến động, đào tạo, phúc lợi (số liệu giả lập)" }]
      },
      { by: "boss", gap: 40, text: "Anh xem rồi. Phần đào tạo em tách riêng chi phí training QC checklist ra cho dễ theo dõi nhé." },
      { by: "admin", gap: 3, text: "Dạ em sửa và gửi lại anh chiều nay ạ." }
    ]
  },
  {
    where: { dm: ["boss", "admin"] },
    date: "2026-10-09",
    time: "19:45",
    lines: [
      {
        by: "admin",
        text: "Anh ơi, em gửi lịch phỏng vấn retoucher tuần sau ạ. Có 11 bạn qua bài test.",
        files: [{ name: "lich-phong-van-retoucher-tuan-42.xlsx", hint: "lịch phỏng vấn 11 ứng viên retoucher: giờ, vòng, người phỏng vấn" }]
      },
      { by: "admin", gap: 3, text: "Vòng cuối em xếp chiều thứ 3 và sáng thứ 5, anh xem có ngồi được không ạ? Chị Linh đã xác nhận lịch rồi." }
    ]
  },

  // ─────────────────────────────── boss ↔ lead1 ───────────────────────────────
  {
    where: { dm: ["boss", "lead1"] },
    date: "2026-08-29",
    time: "09:30",
    lines: [
      { by: "boss", text: "Ca A tuần đầu dùng Nesso Work ổn không em? Có vướng gì với cách báo cáo mới không?" },
      { by: "lead1", gap: 6, text: "Dạ ổn anh, anh em quen dần rồi. Chỉ có vài bạn còn quên cập nhật trạng thái khi chuyển job thôi ạ." },
      { by: "boss", gap: 3, text: "Từ từ kèm các bạn. Tuần sau anh muốn xem sản lượng theo ngày ngay trên đó luôn." },
      { by: "lead1", gap: 1, text: "Dạ ok anh, em nhắc các bạn cuối ca nào cũng cập nhật.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "lead1"] },
    date: "2026-09-18",
    time: "22:40",
    lines: [
      { by: "lead1", text: "Anh ơi, ca đêm nay xong 3/4 job Úc rồi ạ. Job 180 ảnh day-to-dusk dự kiến 2h sáng xong." },
      { by: "boss", gap: 5, text: "Vất vả cho anh em quá. Sáng mai cho ca đêm nghỉ bù, chiều hãy vào nhé." },
      { by: "lead1", gap: 2, text: "Dạ em cảm ơn anh, em báo các bạn liền 🙏", react: { "❤️": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "lead1"] },
    date: "2026-09-21",
    time: "09:50",
    lines: [
      { by: "boss", text: "Sáng nay chuyển sang NAS mới có ảnh hưởng ca A không em?" },
      { by: "lead1", gap: 4, text: "Dạ có ạ, mất khoảng 40 phút do chưa có quyền ghi thư mục. Anh Minh xử lý xong rồi, giờ chạy bình thường." },
      { by: "boss", gap: 2, text: "Ok. Em ghi lại thời gian bị gián đoạn để cuối tuần tính sản lượng cho công bằng nhé." }
    ]
  },
  {
    where: { dm: ["boss", "lead1"] },
    date: "2026-10-06",
    time: "08:10",
    lines: [
      { by: "boss", text: "Sinh nhật vui vẻ nha em! Cảm ơn em đã giữ ca A vững vàng suốt đợt cao điểm vừa rồi 🎉", react: { "❤️": ["lead1"] } },
      { by: "lead1", gap: 9, text: "Dạ em cảm ơn anh nhiều ạ 😄 Em sẽ cố gắng hơn nữa!" }
    ]
  },
  {
    where: { dm: ["boss", "lead1"] },
    date: "2026-10-10",
    time: "16:40",
    lines: [
      {
        by: "lead1",
        text: "Anh ơi em báo nhanh ca A hôm nay: **1.420 ảnh**, tỉ lệ trả lại 1,8%, giảm so với tuần trước ạ.",
        files: [{ name: "san-luong-ca-A-10-10.xlsx", hint: "sản lượng ca A theo từng nhân viên ngày 10/10, tỉ lệ trả lại" }]
      },
      { by: "lead1", gap: 2, text: "Khách Nhật vừa gửi thêm 60 ảnh cut-out, em giao cho nhóm 4 bạn làm kỹ nhất, tối nay QC xong ạ." }
    ]
  },

  // ─────────────────────────────── boss ↔ minh ───────────────────────────────
  {
    where: { dm: ["boss", "minh"] },
    date: "2026-08-25",
    time: "16:30",
    lines: [
      { by: "minh", text: "Anh ơi, Nesso Work ngày đầu chạy ổn ạ, gần như cả công ty đã đăng nhập, chưa có lỗi gì lớn." },
      { by: "boss", gap: 10, text: "Tốt lắm em. Theo dõi giúp anh tốc độ tải ảnh đính kèm, bên sản xuất sẽ gửi ảnh nhiều đó." },
      { by: "minh", gap: 2, text: "Dạ em có bật log rồi anh, cuối tuần em gửi số liệu ạ.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "minh"] },
    date: "2026-09-19",
    time: "17:00",
    lines: [
      { by: "minh", text: "Anh ơi, tối nay em bắt đầu chuyển NAS, dự kiến trưa mai xong. Em đã báo các trưởng ca lưu file trước 18h." },
      { by: "boss", gap: 4, text: "Ok. Backup đầy đủ trước khi chuyển chưa em?" },
      { by: "minh", gap: 1, text: "Dạ có, em backup 2 bản: 1 bản ổ cứng rời, 1 bản lên cloud ạ." },
      { by: "boss", gap: 2, text: "Tốt. Có gì gọi anh, không cần đợi sáng.", react: { "👍": ["minh"] } }
    ]
  },
  {
    where: { dm: ["boss", "minh"] },
    date: "2026-09-21",
    time: "10:30",
    lines: [
      { by: "minh", text: "Dạ sự cố quyền thư mục sáng nay em xử lý xong rồi ạ. Nguyên nhân là nhóm quyền ca B chưa map sang NAS mới." },
      { by: "boss", gap: 6, text: "Ok. Em viết lại checklist chuyển đổi để lần sau không lặp lại nhé." },
      { by: "minh", gap: 1, text: "Dạ chiều nay em viết luôn, lưu trong dự án IT ạ." }
    ]
  },
  {
    where: { dm: ["boss", "minh"] },
    date: "2026-10-07",
    time: "18:20",
    lines: [
      { by: "boss", text: "Website mới tới đâu rồi em? Nhớ ưu tiên tốc độ trên điện thoại, khách nước ngoài hay mở bằng mobile lắm." },
      { by: "minh", gap: 12, text: "Dạ được khoảng 80% rồi anh, còn form báo giá với bản đa ngôn ngữ. Em đang test trên 3 loại máy ạ." },
      { by: "boss", gap: 1, text: "Ok, cố lên em 💪", react: { "🙏": ["minh"] } }
    ]
  },
  {
    where: { dm: ["boss", "minh"] },
    date: "2026-10-10",
    time: "17:10",
    lines: [
      { by: "minh", text: "Anh ơi, em đã chuyển lịch backup tự động NAS sang 2h sáng hàng ngày, kiểm tra 3 đêm liền đều ổn ạ." },
      {
        by: "minh",
        gap: 3,
        text: "Tuần sau em xin anh 15 phút để trình bày phương án mua thêm ổ cứng dự phòng nhé ạ.",
        files: [{ name: "de-xuat-o-cung-du-phong.pdf", hint: "đề xuất mua ổ cứng dự phòng cho NAS: phương án, dung lượng, lịch triển khai" }]
      }
    ]
  },

  // ─────────────────────────────── boss ↔ acc1 ───────────────────────────────
  {
    where: { dm: ["boss", "acc1"] },
    date: "2026-08-27",
    time: "11:00",
    lines: [
      { by: "acc1", text: "Anh ơi, khách BĐS bên Úc vừa xác nhận gia hạn hợp đồng thêm 6 tháng ạ!", react: { "🎉": ["boss"] } },
      { by: "boss", gap: 3, text: "Tuyệt vời 👏 Em giữ liên lạc đều với họ, mỗi tháng gửi một báo cáo chất lượng ngắn nhé." },
      { by: "acc1", gap: 2, text: "Dạ em làm ạ." }
    ]
  },
  {
    where: { dm: ["boss", "acc1"] },
    date: "2026-09-16",
    time: "13:20",
    lines: [
      {
        by: "acc1",
        text: "Anh ơi, agency ở Mỹ phàn nàn 12 ảnh bị màu trời hơi tím. Em đã xin lỗi khách và hẹn trả lại trong 3 tiếng ạ.",
        thread: [
          { by: "boss", gap: 170, text: "Khách phản hồi lại chưa em?" },
          { by: "acc1", gap: 8, text: "Dạ khách ok rồi anh, còn khen bản làm lại nhìn tự nhiên hơn ạ 😄", react: { "👍": ["boss"] } }
        ]
      },
      { by: "boss", gap: 4, text: "Ok. Báo Khoa kiểm tra lại preset trời, đừng để lặp lại." },
      { by: "acc1", gap: 1, text: "Dạ em báo rồi, anh Khoa đang cho làm lại bằng preset mới ạ." },
      { by: "boss", gap: 3, text: "Gửi bản sửa kèm lời xin lỗi, lần đặt sau tặng họ 10 ảnh miễn phí." },
      { by: "acc1", gap: 1, text: "Dạ vâng ạ." }
    ]
  },
  {
    where: { dm: ["boss", "acc1"] },
    date: "2026-10-05",
    time: "09:40",
    lines: [
      {
        by: "acc1",
        text: "Anh ơi, khách Nhật mới đồng ý chạy thử 200 ảnh product cut-out tuần này. Yêu cầu viền rất khắt khe, sai lệch tối đa 1px ạ.",
        files: [{ name: "yeu-cau-ky-thuat-khach-Nhat.pdf", hint: "yêu cầu kỹ thuật cut-out: viền, nền trắng, path, bóng đổ" }]
      },
      { by: "boss", gap: 7, text: "Đơn này quan trọng. Em làm việc với Khoa và trưởng ca A, chọn các bạn tay nghề tốt nhất." },
      { by: "acc1", gap: 2, text: "Dạ em rõ ạ. Deadline lô thử là chiều thứ 6.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "acc1"] },
    date: "2026-10-09",
    time: "20:15",
    lines: [
      { by: "acc1", text: "Anh ơi báo anh tin vui: có thêm khách mới, một studio nội thất ở Canada muốn đặt thử virtual staging 40 ảnh tuần sau ạ 🎉" },
      {
        by: "acc1",
        gap: 2,
        text: "Em đã gửi báo giá chuẩn và bộ ảnh mẫu, mai em gọi lại chốt deadline ạ.",
        edited: "Em đã gửi báo giá chuẩn và bộ ảnh mẫu staging, sáng mai em gọi lại chốt deadline ạ."
      }
    ]
  },
  {
    where: { dm: ["boss", "acc1"] },
    date: "2026-10-10",
    time: "14:30",
    lines: [
      { by: "acc1", text: "Dạ khách Nhật phản hồi lô thử 200 ảnh: đạt 97%, chỉ 6 ảnh cần chỉnh lại viền tóc. Họ muốn bàn đơn hàng tháng từ tháng 11 ạ!" },
      { by: "acc1", gap: 3, text: "Em xin anh 15 phút sáng thứ 2 để chốt điều khoản trước khi gửi khách nhé ạ." }
    ]
  },

  // ─────────────────────────────── boss ↔ khoa ───────────────────────────────
  {
    where: { dm: ["boss", "khoa"] },
    date: "2026-09-03",
    time: "15:00",
    lines: [
      {
        by: "khoa",
        text: "Anh ơi, em đề xuất làm QC checklist v2, tách riêng cho HDR, thay trời và virtual staging. Bản nháp em gửi anh ạ.",
        files: [{ name: "QC-checklist-v2-nhap.docx", hint: "bản nháp checklist QC v2 chia theo loại dịch vụ" }]
      },
      { by: "boss", gap: 30, text: "Hay đó em. Bổ sung thêm phần lỗi hay gặp, mỗi lỗi có ảnh trước/sau minh hoạ nhé." },
      { by: "khoa", gap: 2, text: "Dạ em bổ sung, dự kiến đầu tháng 10 áp dụng ạ.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "khoa"] },
    date: "2026-09-17",
    time: "18:30",
    lines: [
      { by: "boss", text: "Mấy hôm nay tỉ lệ trả lại tăng, em thấy nguyên nhân chính là gì?" },
      { by: "khoa", gap: 5, text: "Dạ chủ yếu 3 lỗi:\n\n- Kéo cửa sổ chưa sạch\n- Trời lệch tông màu\n- Đường dọc bị nghiêng\n\nCác bạn làm gấp nên bỏ qua bước tự kiểm tra ạ." },
      { by: "boss", gap: 3, text: "Dù gấp cũng không được bỏ bước kiểm tra. Em siết lại giúp anh." },
      { by: "khoa", gap: 1, text: "Dạ, từ ca chiều nay em cho QC chéo 100% job Úc ạ.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { dm: ["boss", "khoa"] },
    date: "2026-09-30",
    time: "16:20",
    lines: [
      {
        by: "khoa",
        text: "Anh ơi, báo cáo chất lượng Q3 em gửi ạ. Tỉ lệ đạt lần đầu trung bình 94,5%, tháng 9 giảm do đợt cao điểm.",
        files: [{ name: "bao-cao-chat-luong-Q3.xlsx", hint: "tỉ lệ đạt QC lần đầu theo tháng và theo loại lỗi, quý 3" }]
      },
      { by: "boss", gap: 15, text: "Cảm ơn em. Thứ 2 em trình bày 10 phút trong buổi kickoff Q4 nhé, tập trung vào giải pháp." },
      { by: "khoa", gap: 2, text: "Dạ em chuẩn bị ạ." }
    ]
  },
  {
    where: { dm: ["boss", "khoa"] },
    date: "2026-10-05",
    time: "11:00",
    lines: [
      { by: "boss", text: "Checklist v2 áp dụng từ hôm nay đúng không em?" },
      { by: "khoa", gap: 3, text: "Dạ đúng ạ, ca A em training xong sáng nay, ca B 15h chiều nay ạ." },
      { by: "boss", gap: 1, text: "Tốt 👍" }
    ]
  },
  {
    where: { dm: ["boss", "khoa"] },
    date: "2026-10-09",
    time: "19:10",
    lines: [
      {
        by: "khoa",
        text: "Anh ơi, lô thử khách Nhật 200 ảnh đã gửi lúc 17h45. Trước khi gửi em cho làm lại 11 ảnh viền tóc. Ảnh so sánh em gửi anh xem ạ.",
        files: [{ name: "so-sanh-vien-toc-truoc-sau.png", hint: "so sánh viền tóc người mẫu trước/sau khi tách nền, ảnh sản phẩm thời trang" }]
      },
      { by: "khoa", gap: 2, text: "Em đề xuất lập nhóm 4 bạn chuyên cut-out cố định cho khách này để giữ chất lượng đồng đều ạ." }
    ]
  },

  // ─────────────────────────────── linh ↔ minh ───────────────────────────────
  {
    where: { dm: ["linh", "minh"] },
    date: "2026-08-25",
    time: "10:30",
    lines: [
      { by: "linh", text: "Minh ơi, dự án Sản xuất chị muốn trưởng ca có quyền quản lý, nhân viên là thành viên. Em chỉnh giúp chị nhé." },
      { by: "minh", gap: 3, text: "Dạ ok chị, 10 phút em xong." },
      { by: "minh", gap: 11, text: "Xong rồi chị, chị kiểm tra lại giúp em nha." },
      { by: "linh", gap: 4, text: "Ok rồi, cảm ơn em 👍", react: { "👍": ["minh"] } }
    ]
  },
  {
    where: { dm: ["linh", "minh"] },
    date: "2026-09-08",
    time: "14:00",
    lines: [
      { by: "linh", text: "Máy chị hôm nay chậm quá, mở file Excel mất cả phút 😩" },
      { by: "minh", gap: 6, text: "Chị khởi động lại máy giúp em, chắc do Windows update chạy ngầm. Còn chậm thì em qua xem." },
      { by: "linh", gap: 12, text: "Khởi động lại đỡ hẳn rồi, cảm ơn em nha." }
    ]
  },
  {
    where: { dm: ["linh", "minh"] },
    date: "2026-09-22",
    time: "09:15",
    lines: [
      { by: "linh", text: "Thư mục ca B trên NAS mới vẫn chưa có quyền ghi cho trưởng ca B em ơi." },
      { by: "minh", gap: 2, text: "Dạ em kiểm tra liền." },
      { by: "minh", gap: 8, text: "Em cấp lại quyền rồi chị, nhờ trưởng ca B thử lại giúp em." },
      { by: "linh", gap: 5, text: "Chạy rồi. Thanks em!", react: { "🙏": ["minh"] } }
    ]
  },
  {
    where: { dm: ["linh", "minh"] },
    date: "2026-10-09",
    time: "16:00",
    lines: [
      { by: "linh", text: "Minh ơi, form báo giá trên website mới gửi về đâu vậy em? Email chung hay Nesso Work?" },
      { by: "minh", gap: 4, text: "Dạ về cả hai chị, em cho tự động tạo task trong dự án CSKH luôn." },
      { by: "linh", gap: 2, text: "Ồ hay quá, vậy bên account khỏi phải copy tay nữa 😄", react: { "😂": ["minh"] } },
      { by: "linh", gap: 3, text: "Chị gửi em file kế hoạch Q4 bản cập nhật nha", deleted: true },
      { by: "linh", gap: 1, text: "Nhầm cuộc trò chuyện 😅" },
      { by: "minh", gap: 2, text: "Haha em chưa kịp đọc gì luôn 😂" }
    ]
  },

  // ─────────────────────────────── linh ↔ khoa ───────────────────────────────
  {
    where: { dm: ["linh", "khoa"] },
    date: "2026-08-28",
    time: "15:30",
    lines: [
      { by: "linh", text: "Khoa ơi, tuần đầu dùng Nesso Work, bên QC cập nhật trạng thái có thấy vướng không em?" },
      { by: "khoa", gap: 8, text: "Dạ không vướng chị. Chỉ cần thêm trạng thái \"Chờ QC\" riêng để lọc job cho nhanh ạ." },
      { by: "linh", gap: 2, text: "Ok, chị thêm vào quy trình luôn.", react: { "👍": ["khoa"] } }
    ]
  },
  {
    where: { dm: ["linh", "khoa"] },
    date: "2026-09-16",
    time: "08:20",
    lines: [
      { by: "khoa", text: "Chị ơi, tối nay em xin thêm 2 bạn QC tăng ca, job Úc dồn nhiều quá ạ." },
      { by: "linh", gap: 3, text: "Ok em, chị duyệt. Em gửi tên 2 bạn để chị báo hành chính tính công tăng ca nhé." },
      { by: "khoa", gap: 2, text: "Dạ em ghi trong bảng chấm công ca tối rồi ạ." }
    ]
  },
  {
    where: { dm: ["linh", "khoa"] },
    date: "2026-09-29",
    time: "17:00",
    lines: [
      { by: "linh", text: "Báo cáo chất lượng Q3 em làm tới đâu rồi? Chị cần gộp vào báo cáo quý trước chiều mai." },
      { by: "khoa", gap: 7, text: "Dạ trưa mai em gửi chị, đang tổng hợp tỉ lệ trả lại theo từng khách ạ." },
      { by: "linh", gap: 1, text: "Ok em." }
    ]
  },
  {
    where: { dm: ["linh", "khoa"] },
    date: "2026-10-07",
    time: "10:45",
    lines: [
      { by: "khoa", text: "Chị ơi, khách Nhật yêu cầu file PSD giữ nguyên path, nền trắng tuyệt đối. Mình có cần quy trình riêng cho nhóm cut-out không ạ?" },
      { by: "linh", gap: 5, text: "Có em. Em soạn hướng dẫn ngắn gọn, chị đưa vào checklist của list khách Nhật." },
      { by: "khoa", gap: 1, text: "Dạ, chiều em gửi bản nháp ạ." }
    ]
  },
  {
    where: { dm: ["linh", "khoa"] },
    date: "2026-10-10",
    time: "11:20",
    lines: [
      {
        by: "khoa",
        text: "Chị ơi, em gửi bản hướng dẫn cut-out cho khách Nhật hoàn chỉnh ạ.",
        files: [{ name: "huong-dan-cut-out-khach-Nhat.pdf", hint: "hướng dẫn tách nền sản phẩm: path, viền tóc, nền trắng, bóng đổ" }]
      },
      { by: "linh", gap: 20, text: "Chị đọc rồi, rõ ràng lắm em. Thứ 2 mình training cho nhóm 4 bạn luôn nhé.", react: { "👍": ["khoa"] } },
      { by: "khoa", gap: 2, text: "Dạ ok chị, em đặt phòng họp nhỏ lúc 9h ạ." }
    ]
  },

  // ─────────────────────────────── linh ↔ lead1 ───────────────────────────────
  {
    where: { dm: ["linh", "lead1"] },
    date: "2026-08-31",
    time: "07:50",
    lines: [
      { by: "lead1", text: "Chị ơi, sáng nay ca A thiếu 1 bạn bị ốm. Em xin mượn 1 bạn ca B hỗ trợ tới trưa được không ạ?" },
      { by: "linh", gap: 4, text: "Ok em, em trao đổi với trưởng ca B nhé, chị đồng ý." },
      { by: "lead1", gap: 1, text: "Dạ cảm ơn chị." }
    ]
  },
  {
    where: { dm: ["linh", "lead1"] },
    date: "2026-09-01",
    time: "09:00",
    lines: [
      { by: "linh", text: "Lễ mà em vẫn trực ca, vất vả quá. Có gì gấp cứ nhắn chị nha." },
      { by: "lead1", gap: 5, text: "Dạ chị yên tâm, hôm nay chỉ có 2 job Úc thôi ạ." },
      { by: "linh", gap: 2, text: "Trưa chị đặt cơm cho cả ca trực nhé 🍱", react: { "❤️": ["lead1"] } }
    ]
  },
  {
    where: { dm: ["linh", "lead1"] },
    date: "2026-09-14",
    time: "18:00",
    lines: [
      { by: "lead1", text: "Chị ơi, tuần này đơn Úc về dồn quá, em đề xuất mở ca đêm từ tối nay đến thứ 7 ạ." },
      { by: "linh", gap: 3, text: "Chị đồng ý. Em lên danh sách ca đêm, ưu tiên các bạn tự nguyện, mỗi bạn tối đa 3 đêm/tuần nhé." },
      {
        by: "lead1",
        gap: 35,
        text: "Dạ em gửi danh sách ca đêm tuần này ạ.",
        files: [{ name: "lich-ca-dem-tuan-38.xlsx", hint: "lịch ca đêm 14–19/9, mỗi người tối đa 3 đêm" }],
        thread: [
          { by: "linh", gap: 6, text: "Bạn nào làm 3 đêm liền thì thứ 2 tuần sau cho nghỉ bù nửa ngày nhé." },
          { by: "lead1", gap: 2, text: "Dạ em ghi chú vào lịch rồi ạ." }
        ]
      },
      { by: "linh", gap: 4, text: "Ok chị duyệt 👍" }
    ]
  },
  {
    where: { dm: ["linh", "lead1"] },
    date: "2026-10-09",
    time: "17:45",
    lines: [
      { by: "linh", text: "Tuần sau khách Nhật chạy chính thức, ca A giữ cố định 4 bạn cut-out giúp chị nhé." },
      { by: "lead1", gap: 6, text: "Dạ em xếp rồi chị. Em đang cho thêm 1 bạn làm bài test để làm dự phòng ạ." },
      { by: "linh", gap: 2, text: "Tốt quá. Có kết quả test thì báo chị nha.", react: { "👍": ["lead1"] } }
    ]
  },

  // ─────────────────────────────── linh ↔ admin ───────────────────────────────
  {
    where: { dm: ["linh", "admin"] },
    date: "2026-08-26",
    time: "09:00",
    lines: [
      {
        by: "admin",
        text: "Chị ơi, em gửi danh sách nhân sự theo phòng ban để chị chia thành viên vào các dự án ạ.",
        files: [{ name: "danh-sach-nhan-su-theo-phong-ban.xlsx", hint: "danh sách nhân sự theo phòng ban và ca làm việc (dữ liệu giả lập)" }]
      },
      { by: "linh", gap: 10, text: "Ok em, cảm ơn em. Có cột ca làm việc luôn thì tuyệt." },
      { by: "admin", gap: 3, text: "Dạ có rồi chị, em để ở cột cuối ạ." }
    ]
  },
  {
    where: { dm: ["linh", "admin"] },
    date: "2026-09-04",
    time: "10:30",
    lines: [
      { by: "linh", text: "Em ơi, ngày công ca trực lễ 1–2/9 em tổng hợp giúp chị để tính lương tháng 9 nhé." },
      { by: "admin", gap: 3, text: "Dạ chiều nay em gửi chị ạ." },
      { by: "admin", gap: 240, text: "Dạ em đã cập nhật bảng công ca trực lễ trong thư mục Hành chính trên NAS rồi chị ạ." },
      { by: "linh", gap: 15, text: "Ok chị nhận, cảm ơn em.", react: { "👍": ["admin"] } }
    ]
  },
  {
    where: { dm: ["linh", "admin"] },
    date: "2026-09-23",
    time: "10:00",
    lines: [
      { by: "admin", text: "Chúc mừng sinh nhật chị Linh ạ 🎂 Chiều nay chị nhớ ở văn phòng lúc 16h nha, cả phòng có chút bất ngờ hihi" },
      { by: "linh", gap: 4, text: "Trời ơi, lộ hết bất ngờ rồi em 😂 Chị sẽ có mặt đúng giờ!", react: { "😂": ["admin"] } }
    ]
  },
  {
    where: { dm: ["linh", "admin"] },
    date: "2026-09-28",
    time: "14:00",
    lines: [
      { by: "linh", text: "Chi phí team building em quyết toán xong chưa? Chị cần số trước thứ 4 để đưa vào báo cáo quý." },
      { by: "admin", gap: 6, text: "Dạ còn 2 hoá đơn nhà hàng chưa về, em đã nhắc bên nhà hàng rồi ạ. Thứ 3 em gửi chị bản đầy đủ." },
      { by: "linh", gap: 2, text: "Ok em." }
    ]
  },
  {
    where: { dm: ["linh", "admin"] },
    date: "2026-10-08",
    time: "15:30",
    lines: [
      {
        by: "admin",
        text: "Chị ơi, đợt tuyển retoucher có 34 hồ sơ, 11 bạn qua bài test. Chị xem giúp em lịch phỏng vấn có trùng lịch họp của chị không ạ?",
        files: [{ name: "lich-phong-van-du-kien.xlsx", hint: "lịch phỏng vấn dự kiến tuần 42" }]
      },
      { by: "linh", gap: 12, text: "Sáng thứ 3 chị họp với khách, em dời vòng cuối sang chiều được không?" },
      {
        by: "admin",
        gap: 2,
        text: "Dạ được ạ, em sửa lại rồi gửi anh bản chính thức nhé.",
        edited: "Dạ được ạ, em sửa lại rồi gửi sếp duyệt bản chính thức nhé."
      }
    ]
  },

  // ─────────────────────────────── minh ↔ an ───────────────────────────────
  {
    where: { dm: ["minh", "an"] },
    date: "2026-08-27",
    time: "14:20",
    lines: [
      { by: "an", text: "Anh Minh ơi, em đổi avatar trên Nesso Work không được, cứ báo ảnh quá lớn ạ." },
      { by: "minh", gap: 4, text: "Ảnh em bao nhiêu MB? Giới hạn là 5MB nha." },
      { by: "an", gap: 3, text: "Dạ 12MB 😅 Em nén lại rồi, đổi được rồi ạ." },
      { by: "minh", gap: 1, text: "Ok 👍" }
    ]
  },
  {
    where: { dm: ["minh", "an"] },
    date: "2026-09-10",
    time: "10:00",
    lines: [
      {
        by: "an",
        text: "Anh ơi, Photoshop máy em cứ crash khi mở file PSD lớn ạ 😢",
        files: [{ name: "Ảnh lỗi Photoshop.png", hint: "hộp thoại báo lỗi Photoshop bị đóng đột ngột khi mở file PSD lớn" }]
      },
      { by: "minh", gap: 5, text: "Em vào `Preferences > Performance`, tăng RAM cho Photoshop lên khoảng 70% thử nha. Máy em 32GB, dư sức." },
      { by: "an", gap: 15, text: "Dạ chạy mượt hơn hẳn rồi, cảm ơn anh!", react: { "👍": ["minh"] } }
    ]
  },
  {
    where: { dm: ["minh", "an"] },
    date: "2026-10-02",
    time: "11:00",
    lines: [
      { by: "minh", text: "An ơi, ảnh hero cho trang chủ em xuất giúp anh định dạng WebP, chiều ngang 1920px nhé." },
      { by: "an", gap: 3, text: "Dạ ok anh, chiều em gửi ạ." },
      {
        by: "an",
        gap: 200,
        text: "Em gửi anh bản xem trước, file WebP em để trong thư mục Website trên NAS rồi ạ.",
        files: [{ name: "hero-trang-chu-01.jpg", hint: "ảnh hero trang chủ: phòng khách HDR lúc hoàng hôn" }]
      },
      { by: "minh", gap: 10, text: "Đẹp quá em 🔥 Anh up lên bản test luôn.", react: { "❤️": ["an"] } }
    ]
  },
  {
    where: { dm: ["minh", "an"] },
    date: "2026-10-08",
    time: "16:10",
    lines: [
      { by: "an", text: "Anh ơi, font tiếng Việt ở trang Giới thiệu bị lỗi dấu chữ \"Ước\" với \"Ưu\" ạ." },
      { by: "minh", gap: 7, text: "Do font chưa có bộ ký tự tiếng Việt đầy đủ. Anh đổi sang bản full rồi, em tải lại trang xem." },
      { by: "an", gap: 2, text: "Dạ hết lỗi rồi ạ 🙏" }
    ]
  },
  {
    where: { dm: ["minh", "an"] },
    date: "2026-10-10",
    time: "10:30",
    lines: [
      { by: "minh", text: "An ơi, banner portfolio trên mobile bị cắt mất chữ, em làm thêm 1 bản tỉ lệ 4:5 giúp anh nha." },
      { by: "an", gap: 4, text: "Dạ chiều nay em gửi anh ạ." },
      {
        by: "an",
        gap: 230,
        text: "Em gửi anh bản mobile nè, chữ em đẩy lên nửa trên luôn ạ.",
        files: [{ name: "banner-portfolio-mobile-4x5.png", hint: "banner portfolio dọc tỉ lệ 4:5, ảnh before/after và tiêu đề" }]
      },
      { by: "minh", gap: 8, text: "Chuẩn rồi, cảm ơn em 👍", react: { "❤️": ["an"] } }
    ]
  },

  // ─────────────────────────────── khoa ↔ lead2 ───────────────────────────────
  {
    where: { dm: ["khoa", "lead2"] },
    date: "2026-09-02",
    time: "08:30",
    lines: [
      { by: "lead2", text: "Anh Khoa ơi, hôm nay ca trực có job HDR 60 ảnh, phần QC ai kiểm ạ?" },
      { by: "khoa", gap: 6, text: "Anh trực online. Làm xong em đẩy lên thư mục chờ QC, anh kiểm từ xa nhé." },
      { by: "lead2", gap: 1, text: "Dạ ok anh." }
    ]
  },
  {
    where: { dm: ["khoa", "lead2"] },
    date: "2026-09-17",
    time: "15:00",
    lines: [
      { by: "khoa", text: "Ca B hôm qua có 9 ảnh trời bị lệch tông, em nhắc các bạn dùng đúng preset v3 nhé." },
      { by: "lead2", gap: 5, text: "Dạ em xin lỗi anh, có 2 bạn mới còn dùng preset cũ. Em xoá preset cũ trên máy các bạn rồi ạ." },
      { by: "khoa", gap: 2, text: "Ok, làm vậy là đúng. Cảm ơn em.", react: { "👍": ["lead2"] } }
    ]
  },
  {
    where: { dm: ["khoa", "lead2"] },
    date: "2026-10-05",
    time: "14:30",
    lines: [
      { by: "khoa", text: "15h anh training checklist v2 cho ca B, em gom anh em giúp anh nhé." },
      { by: "lead2", gap: 2, text: "Dạ phòng họp nhỏ nhé anh, em báo đủ các bạn rồi ạ." },
      { by: "khoa", gap: 1, text: "Ok." }
    ]
  },
  {
    where: { dm: ["khoa", "lead2"] },
    date: "2026-10-10",
    time: "15:40",
    lines: [
      { by: "lead2", text: "Anh ơi, ca B hôm nay tỉ lệ đạt QC lần đầu 96%, cao nhất từ đầu tháng ạ 💪", react: { "🔥": ["khoa"] } },
      { by: "khoa", gap: 4, text: "Tốt lắm! Em khen các bạn giúp anh nhé 👏" },
      { by: "lead2", gap: 2, text: "Dạ mấy bạn vui lắm ạ. Tuần sau em xin thêm 1 buổi ôn lỗi kéo cửa sổ cho 2 bạn mới." },
      { by: "khoa", gap: 3, text: "Ok, thứ 3 anh sắp xếp." }
    ]
  },

  // ─────────────────────────────── lead1 ↔ nv03 ───────────────────────────────
  {
    where: { dm: ["lead1", "nv03"] },
    date: "2026-09-07",
    time: "07:40",
    lines: [
      { by: "nv03", text: "Dạ em xin phép vào trễ 30 phút, xe em bị thủng lốp giữa đường ạ 😢" },
      { by: "lead1", gap: 2, text: "Ok em, đi cẩn thận nhé. Job HDR sáng nay để tới 10h cũng kịp." },
      { by: "nv03", gap: 1, text: "Dạ em cảm ơn ạ." }
    ]
  },
  {
    where: { dm: ["lead1", "nv03"] },
    date: "2026-09-12",
    time: "16:30",
    lines: [
      { by: "nv03", text: "Dạ em xin nghỉ phép thứ 6 tuần sau (18/9) để về quê dự đám cưới chị gái ạ." },
      { by: "lead1", gap: 8, text: "Tuần sau đơn Úc dồn nhiều, em đổi sang thứ 2 tuần kế được không?" },
      { by: "nv03", gap: 3, text: "Dạ đám cưới đúng thứ 6 nên em khó đổi ạ 🙏" },
      { by: "lead1", gap: 5, text: "Ok, vậy thứ 3 với thứ 4 em làm thêm 2 tiếng bù giúp ca nhé. Nhớ tạo đơn nghỉ phép trên Nesso Work." },
      { by: "nv03", gap: 1, text: "Dạ em cảm ơn, em tạo đơn liền ạ.", react: { "👍": ["lead1"] } }
    ]
  },
  {
    where: { dm: ["lead1", "nv03"] },
    date: "2026-09-24",
    time: "11:00",
    lines: [
      { by: "lead1", text: "Job sáng nay em kéo cửa sổ đẹp lắm, khách khen đó. Giữ phong độ nha 👍", react: { "❤️": ["nv03"] } },
      { by: "nv03", gap: 3, text: "Dạ em cảm ơn ạ, em làm theo checklist của anh Khoa đó 😄" }
    ]
  },
  {
    where: { dm: ["lead1", "nv03"] },
    date: "2026-10-09",
    time: "14:10",
    lines: [
      { by: "nv03", text: "Dạ em muốn đăng ký vào nhóm cut-out khách Nhật ạ. Em có làm clipping path 1 năm ở chỗ cũ." },
      { by: "lead1", gap: 10, text: "Ok, em làm bài test 10 ảnh trong thư mục `test-cut-out-nhat` trên NAS nhé, thứ 2 anh Khoa chấm." },
      { by: "nv03", gap: 1, text: "Dạ em làm luôn chiều nay ạ." }
    ]
  },
  {
    where: { dm: ["lead1", "nv03"] },
    date: "2026-10-10",
    time: "17:20",
    lines: [
      {
        by: "nv03",
        text: "Em làm xong 10 ảnh test rồi ạ, em để đủ trong thư mục rồi.",
        files: [{ name: "test-cut-out-01.png", hint: "ảnh sản phẩm túi xách đã tách nền trắng, viền sắc" }]
      },
      { by: "lead1", gap: 9, text: "Ok, nhìn sơ viền ổn đó. Thứ 2 có kết quả nha." }
    ]
  },

  // ─────────────────────────────── an ↔ hanh (hanh only before 09-30) ───────────────────────────────
  {
    where: { dm: ["an", "hanh"] },
    date: "2026-08-25",
    time: "13:30",
    lines: [
      { by: "hanh", text: "Dạ em chào, em là Hạnh, thực tập marketing ạ. Em vào Nesso Work được rồi, tuần này em bắt đầu từ việc gì ạ?" },
      { by: "an", gap: 6, text: "Chào em! Em vào dự án Marketing, list \"Fanpage tháng 9\" nhé. Việc đầu tiên là gom ảnh before/after đẹp cho 4 bài đầu tháng." },
      { by: "hanh", gap: 2, text: "Dạ em làm liền ạ 😊" }
    ]
  },
  {
    where: { dm: ["an", "hanh"] },
    date: "2026-09-03",
    time: "15:00",
    lines: [
      {
        by: "hanh",
        text: "Em gửi bản nháp caption bài before/after thay trời ạ.",
        files: [{ name: "caption-thay-troi-nhap.docx", hint: "bản nháp caption fanpage cho bài before/after thay trời" }]
      },
      { by: "an", gap: 20, text: "Ổn đó em. Câu mở đầu rút ngắn lại chút, cuối bài thêm lời mời gửi ảnh làm thử nhé." },
      { by: "hanh", gap: 2, text: "Dạ em sửa lại ạ." }
    ]
  },
  {
    where: { dm: ["an", "hanh"] },
    date: "2026-09-15",
    time: "10:20",
    lines: [
      {
        by: "hanh",
        text: "Ảnh bìa fanpage em làm 2 phương án, mình chọn bản nào ạ?",
        files: [
          { name: "anh-bia-phuong-an-1.jpg", hint: "ảnh bìa fanpage tông cam, ảnh nhà phố before/after" },
          { name: "anh-bia-phuong-an-2.jpg", hint: "ảnh bìa fanpage tông xanh, ảnh phòng khách HDR" }
        ]
      },
      { by: "an", gap: 9, text: "Phương án 2 nha, tông xanh hợp nhận diện hơn. Chữ tiêu đề to thêm khoảng 10%.", react: { "👍": ["hanh"] } },
      { by: "hanh", gap: 2, text: "Dạ ok ạ!" }
    ]
  },
  {
    where: { dm: ["an", "hanh"] },
    date: "2026-09-29",
    time: "16:30",
    lines: [
      { by: "hanh", text: "Mai là ngày cuối thực tập của em rồi. Em cảm ơn đã hướng dẫn em tận tình suốt thời gian qua ạ 🥹", react: { "❤️": ["an"] } },
      { by: "an", gap: 5, text: "Em làm tốt lắm đó Hạnh! Bài before/after của em tương tác cao nhất tháng 9 luôn. Có dịp quay lại nhé ❤️" },
      { by: "hanh", gap: 2, text: "Dạ nhất định ạ, em sẽ nhớ mọi người lắm 😢", react: { "❤️": ["an"] } },
      {
        by: "hanh",
        gap: 30,
        text: "Em gửi file bàn giao các bài nháp và nguồn ảnh ạ.",
        files: [{ name: "ban-giao-cong-viec-thuc-tap-marketing.xlsx", hint: "danh sách bài nháp, trạng thái, đường dẫn nguồn ảnh" }]
      },
      { by: "an", gap: 6, text: "Nhận đủ rồi, cảm ơn em nha." }
    ]
  },

  // ─────────────────────────────── acc1 ↔ lead1 ───────────────────────────────
  {
    where: { dm: ["acc1", "lead1"] },
    date: "2026-08-28",
    time: "10:15",
    lines: [
      { by: "acc1", text: "Job 240 ảnh HDR khách Úc, deadline 6h sáng mai giờ VN, ca A nhận được không?" },
      { by: "lead1", gap: 4, text: "Được, mình chia 6 bạn, 18h xong để QC." },
      { by: "acc1", gap: 1, text: "Ok cảm ơn nha 🙏" }
    ]
  },
  {
    where: { dm: ["acc1", "lead1"] },
    date: "2026-09-15",
    time: "16:45",
    lines: [
      { by: "acc1", text: "Khách Úc gửi thêm 35 ảnh vào job sáng nay, deadline không đổi 😭" },
      { by: "lead1", gap: 3, text: "Trời. Ok để mình gọi thêm 2 bạn ca chiều. Lần sau nhắc khách gửi gộp giúp mình nha." },
      {
        by: "acc1",
        gap: 2,
        text: "Nhắc rồi mà khách cứ gửi lẻ. Mình sẽ đề xuất họ chốt ảnh trước 15h.",
        edited: "Nhắc rồi mà khách cứ gửi lẻ. Mình sẽ đề xuất họ chốt ảnh trước 15h mỗi ngày (giờ VN)."
      },
      { by: "lead1", gap: 1, text: "Ok, vậy được.", react: { "🙏": ["acc1"] } }
    ]
  },
  {
    where: { dm: ["acc1", "lead1"] },
    date: "2026-09-30",
    time: "11:30",
    lines: [
      {
        by: "acc1",
        text: "Note cho ca A: khách Mỹ muốn trời xanh nhạt tự nhiên, không đậm như khách Úc nha.",
        files: [{ name: "mau-troi-khach-My.png", hint: "so sánh 2 tông màu trời: xanh nhạt tự nhiên và xanh đậm" }]
      },
      { by: "lead1", gap: 5, text: "Ok, mình in ra dán ở bàn các bạn luôn.", react: { "👍": ["acc1"] } }
    ]
  },
  {
    where: { dm: ["acc1", "lead1"] },
    date: "2026-10-07",
    time: "09:20",
    lines: [
      { by: "acc1", text: "Lô thử khách Nhật 200 ảnh đã lên thư mục, deadline thứ 6 18h nha." },
      { by: "lead1", gap: 4, text: "Ok, nhóm 4 bạn làm, mình cho QC chéo trước khi chuyển anh Khoa." },
      { by: "acc1", gap: 1, text: "Tuyệt, khách này mà ổn là có đơn đều hàng tháng đó 🤞" }
    ]
  },
  {
    where: { dm: ["acc1", "lead1"] },
    date: "2026-10-10",
    time: "13:50",
    lines: [
      { by: "acc1", text: "Khách Nhật khen lô đầu rồi nè 🎉 Đạt 97%, chỉ 6 ảnh cần chỉnh viền tóc. Cảm ơn ca A nhiều nha!", react: { "🎉": ["lead1"] } },
      { by: "lead1", gap: 3, text: "Yeah, anh em mừng lắm. 6 ảnh viền tóc tối nay sửa xong nha." },
      { by: "acc1", gap: 1, text: "Ok, mình hẹn khách sáng thứ 2 giao bản sửa." }
    ]
  },

  // ─────────────────────────────── admin ↔ nv07 ───────────────────────────────
  {
    where: { dm: ["admin", "nv07"] },
    date: "2026-09-09",
    time: "09:30",
    lines: [
      { by: "nv07", text: "Dạ cho em hỏi giờ đơn nghỉ phép tạo trên Nesso Work hay vẫn ghi giấy ạ?" },
      { by: "admin", gap: 4, text: "Em tạo trên Nesso Work nhé, trong dự án Nhân sự, mục Nghỉ phép, gán trưởng ca duyệt." },
      { by: "nv07", gap: 8, text: "Dạ em tạo được rồi ạ, cảm ơn ạ." }
    ]
  },
  {
    where: { dm: ["admin", "nv07"] },
    date: "2026-09-21",
    time: "10:40",
    lines: [
      { by: "nv07", text: "Dạ em thấy bảng công tháng 9 em bị thiếu 1 ngày hôm 2/9, trong khi em có đi trực ca lễ ạ." },
      { by: "admin", gap: 3, text: "Để mình kiểm tra lại bảng chấm công nha." },
      { by: "admin", gap: 25, text: "Đúng là sót tên em trong danh sách ca trực. Mình sửa rồi, lương tháng 9 sẽ tính đủ cả phụ cấp lễ nhé." },
      { by: "nv07", gap: 2, text: "Dạ em cảm ơn nhiều ạ 🙏", react: { "👍": ["admin"] } }
    ]
  },
  {
    where: { dm: ["admin", "nv07"] },
    date: "2026-10-05",
    time: "13:15",
    lines: [
      { by: "nv07", text: "Dạ em nhận lương tháng 9 rồi, đủ phụ cấp lễ luôn ạ. Cảm ơn ạ!", react: { "❤️": ["admin"] } },
      { by: "admin", gap: 5, text: "Ok em 😊" }
    ]
  },
  {
    where: { dm: ["admin", "nv07"] },
    date: "2026-10-09",
    time: "16:20",
    lines: [
      { by: "admin", text: "Em ơi, em đăng ký khám sức khoẻ định kỳ đợt tháng 10 chưa? Hạn chót thứ 3 tuần sau nha." },
      { by: "nv07", gap: 12, text: "Dạ em chưa ạ, em đăng ký ở đâu ạ?" },
      { by: "admin", gap: 2, text: "Em điền [form đăng ký khám sức khoẻ](https://nesso.example/forms/kham-suc-khoe) nhé, chọn ngày 24 hoặc 31/10." },
      { by: "nv07", gap: 6, text: "Dạ em chọn ngày 31 ạ", deleted: true },
      { by: "nv07", gap: 2, text: "Dạ em đăng ký ngày 24 rồi ạ, ngày 31 em vướng ca đêm." },
      { by: "admin", gap: 3, text: "Ok em, mình ghi nhận rồi.", react: { "🙏": ["nv07"] } }
    ]
  },

  // ═══════════════════════════════ GROUP: g-website (boss, minh, an, linh) ═══════════════════════════════
  {
    where: { group: "g-website" },
    date: "2026-09-24",
    time: "10:00",
    lines: [
      {
        by: "boss",
        text: "Anh lập nhóm này để làm lại website công ty, mục tiêu ra mắt **15/10**.\n\n- @{minh} lo kỹ thuật\n- @{an} lo giao diện, hình ảnh\n- @{linh} điều phối nội dung và tiến độ",
        react: { "👍": ["linh", "minh", "an"] }
      },
      { by: "linh", gap: 3, text: "Dạ, em tạo dự án riêng trên Nesso Work để theo dõi tiến độ ạ." },
      { by: "minh", gap: 4, text: "Em đề xuất giữ hosting hiện tại, làm mới giao diện và thêm trang portfolio before/after ạ." },
      { by: "an", gap: 2, text: "Trong tuần em gửi moodboard cho mọi người xem nha ✨" }
    ]
  },
  {
    where: { group: "g-website" },
    date: "2026-09-29",
    time: "15:30",
    lines: [
      {
        by: "an",
        text: "Moodboard website mới em gửi mọi người ạ, có 2 hướng:\n\n1. Tối giản trắng – xám\n2. Full ảnh nền, nhấn mạnh before/after",
        files: [
          { name: "moodboard-website-huong-1.png", hint: "moodboard tối giản nền trắng xám, chữ đen, nhiều khoảng trắng" },
          { name: "moodboard-website-huong-2.png", hint: "moodboard full ảnh nền bất động sản, thanh trượt before/after" }
        ],
        react: { "👀": ["minh"] },
        thread: [
          { by: "boss", gap: 12, text: "Anh thích hướng 2, ảnh chính là sản phẩm của mình mà." },
          { by: "linh", gap: 3, text: "Em cũng chọn hướng 2, nhưng trang báo giá nên giữ nền trắng cho dễ đọc ạ." },
          { by: "an", gap: 4, text: "Dạ ok, em kết hợp như vậy ạ 👍", react: { "👍": ["boss"] } }
        ]
      }
    ]
  },
  {
    where: { group: "g-website" },
    date: "2026-10-05",
    time: "16:00",
    lines: [
      {
        by: "linh",
        text: "Checklist nội dung website:\n\n[x] Giới thiệu công ty\n[x] Dịch vụ (8 mảng)\n[ ] Portfolio before/after — @{an}\n[ ] Bảng giá tham khảo — chờ anh duyệt\n[ ] Form báo giá — @{minh}\n[ ] Bản tiếng Anh + tiếng Nhật",
        react: { "✅": ["boss"] }
      },
      { by: "boss", gap: 15, text: "Bảng giá để dạng \"liên hệ báo giá\", không công khai số trên web nhé." },
      { by: "linh", gap: 2, text: "Dạ em sửa lại mục đó ạ." },
      { by: "minh", gap: 3, text: "Form báo giá em làm xong trong tuần này ạ." }
    ]
  },
  {
    where: { group: "g-website" },
    date: "2026-10-08",
    time: "09:30",
    lines: [
      { by: "boss", text: "Bản tiếng Nhật ai dịch vậy em? Khách Nhật mới chắc chắn sẽ vào xem." },
      { by: "linh", gap: 4, text: "Dạ em thuê một bạn dịch tự do, thứ 2 có bản ạ." },
      { by: "boss", gap: 2, text: "Ok, dịch xong nhờ người bản xứ đọc lại 1 lượt cho chắc." },
      { by: "an", gap: 6, text: "Ảnh before/after em xuất xong 24 cặp rồi ạ, chờ anh Minh up lên." },
      { by: "minh", gap: 3, text: "Chiều nay anh up nha @{an}." },
      { by: "linh", gap: 5, text: "Vậy mình chốt ra mắt sáng thứ 5, 15/10 nhé mọi người.", react: { "👍": ["boss", "minh", "an"] } }
    ]
  },
  {
    where: { group: "g-website" },
    date: "2026-10-10",
    time: "16:15",
    lines: [
      {
        by: "minh",
        text: "@{boss} anh ơi, bản preview website em đã lên rồi ạ: [Xem bản preview](https://nesso.example/preview-website-2026)",
        react: { "🔥": ["an"], "👀": ["linh"] }
      },
      { by: "minh", gap: 2, text: "Anh xem trên điện thoại giúp em luôn nhé, em đã tối ưu giao diện mobile rồi ạ." },
      { by: "an", gap: 4, text: "Woa, trang portfolio lên đẹp quá anh Minh 😍" },
      { by: "linh", gap: 5, text: "@{boss} em đã đọc hết nội dung tiếng Việt, bản tiếng Nhật thứ 2 em cập nhật ạ." },
      {
        by: "minh",
        gap: 25,
        text: "@{an} trang Liên hệ trên iPhone bị lệch nút Gửi, em xem lại file thiết kế giúp anh nha.",
        files: [{ name: "lien-he-iphone-lech-nut.png", hint: "ảnh chụp màn hình trang Liên hệ trên điện thoại, nút Gửi bị lệch phải" }]
      },
      { by: "an", gap: 3, text: "Dạ em xem liền ạ." }
    ]
  },

  // ═══════════════════════════════ GROUP: g-taichinh (boss, linh, admin, acc1) ═══════════════════════════════
  {
    where: { group: "g-taichinh" },
    date: "2026-08-31",
    time: "16:00",
    lines: [
      {
        by: "boss",
        text: "Nhóm này dùng riêng cho chi phí, lương, hoá đơn. Các thông tin này không trao đổi ở kênh chung nhé.",
        react: { "👍": ["linh", "admin", "acc1"] }
      },
      { by: "admin", gap: 3, text: "Dạ anh, bảng lương tháng 8 em gửi trước ngày 3/9 ạ." },
      { by: "acc1", gap: 2, text: "Em sẽ cập nhật tình hình công nợ khách mỗi sáng thứ 2 ạ." }
    ]
  },
  {
    where: { group: "g-taichinh" },
    date: "2026-09-03",
    time: "09:45",
    lines: [
      {
        by: "admin",
        text: "Em gửi bảng lương tháng 8 để anh duyệt ạ.",
        files: [{ name: "bang-luong-thang-8.xlsx", hint: "bảng lương tháng 8 (số liệu giả lập): ngày công, tăng ca, phụ cấp" }],
        thread: [
          { by: "boss", gap: 35, text: "Phần tăng ca đêm em kiểm tra lại, anh thấy thiếu 2 bạn trực cuối tuần." },
          { by: "admin", gap: 10, text: "Dạ đúng ạ, em đã bổ sung 2 bạn và cập nhật file rồi anh." },
          { by: "boss", gap: 6, text: "Ok, anh duyệt.", react: { "🙏": ["admin"] } }
        ]
      }
    ]
  },
  {
    where: { group: "g-taichinh" },
    date: "2026-09-14",
    time: "10:30",
    lines: [
      {
        by: "acc1",
        text: "Báo cáo công nợ tuần ạ: 2 khách Úc thanh toán chậm khoảng 15 ngày, em đã gửi nhắc nhẹ.",
        files: [{ name: "cong-no-tuan-38.pdf", hint: "bảng theo dõi công nợ khách theo tuần (dữ liệu giả lập)" }]
      },
      { by: "boss", gap: 8, text: "Khách lâu năm thì nhắc nhẹ thôi. Quá 30 ngày thì báo anh." },
      { by: "linh", gap: 3, text: "Em đề xuất thêm điều khoản thanh toán trước 50% cho khách mới ạ." },
      { by: "boss", gap: 2, text: "Đồng ý. @{acc1} cập nhật vào mẫu báo giá giúp anh nhé." },
      { by: "acc1", gap: 1, text: "Dạ em làm trong hôm nay ạ.", react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { group: "g-taichinh" },
    date: "2026-09-30",
    time: "17:00",
    lines: [
      {
        by: "linh",
        text: "Tổng kết Q3: sản lượng tăng 18% so với Q2, chi phí tăng ca cao do đợt cao điểm tháng 9. Báo cáo chi tiết em gửi ạ.",
        files: [{ name: "bao-cao-quy-3.pdf", hint: "báo cáo quý 3: sản lượng, chất lượng, chi phí (số liệu giả lập)" }],
        react: { "👍": ["admin", "acc1"] }
      },
      { by: "boss", gap: 20, text: "Cảm ơn em. Q4 kiểm soát tăng ca bằng cách tuyển thêm người như kế hoạch, đừng để anh em đuối như tháng 9." },
      { by: "admin", gap: 3, text: "Dạ đợt tuyển 6 bạn em đăng tin từ 1/10 ạ." }
    ]
  },
  {
    where: { group: "g-taichinh" },
    date: "2026-10-05",
    time: "10:00",
    lines: [
      { by: "admin", text: "Lương tháng 9 đã chuyển xong cho cả công ty rồi ạ ✅", react: { "👍": ["boss"], "🙏": ["linh"] } },
      { by: "boss", gap: 5, text: "Cảm ơn em." },
      { by: "linh", gap: 2, text: "Em đã nhắc mọi người kiểm tra phiếu lương trên hệ thống, có thắc mắc thì nhắn @{admin} ạ." }
    ]
  },
  {
    where: { group: "g-taichinh" },
    date: "2026-10-08",
    time: "17:30",
    lines: [
      { by: "boss", text: "@{linh} em bắt đầu nháp ngân sách 2027 giúp anh nhé, ưu tiên 3 mục: nhân sự, thiết bị, marketing. Chỉ trao đổi trong nhóm này, chưa công bố." },
      { by: "linh", gap: 4, text: "Dạ, thứ 7 em gửi anh bản nháp ạ." },
      { by: "acc1", gap: 3, text: "Em gửi chị Linh dự báo doanh thu theo nhóm khách để làm cơ sở nha.", react: { "👍": ["linh"] } }
    ]
  },
  {
    where: { group: "g-taichinh" },
    date: "2026-10-10",
    time: "17:05",
    lines: [
      {
        by: "linh",
        text: "@{boss} em gửi bản nháp ngân sách 2027 ạ. Có 2 điểm cần anh quyết:\n\n1. Mua thêm 8 máy trạm cho đợt tuyển mới\n2. Tăng ngân sách quảng cáo cho thị trường Nhật",
        files: [{ name: "ngan-sach-2027-nhap-v1.xlsx", hint: "bản nháp ngân sách 2027 theo 3 nhóm: nhân sự, thiết bị, marketing (số liệu giả lập)" }]
      },
      { by: "acc1", gap: 6, text: "Em đã điền phần dự báo doanh thu nửa đầu 2027, khách Nhật em để kịch bản thận trọng ạ." },
      { by: "admin", gap: 4, text: "@{boss} phần nhân sự em tính theo phương án tuyển 6 + 4 bạn ạ." }
    ]
  },

  // ═══════════════════════════════ GROUP: g-khach-kho (acc1, acc2, lead1, khoa) ═══════════════════════════════
  {
    where: { group: "g-khach-kho" },
    date: "2026-09-02",
    time: "10:00",
    lines: [
      {
        by: "acc1",
        text: "Lập nhóm này để xử lý nhanh mấy khách khó tính nha mọi người, đỡ trôi tin bên kênh sản xuất.",
        react: { "👍": ["acc2", "lead1", "khoa"] }
      },
      { by: "khoa", gap: 5, text: "Ok. Có phản hồi lỗi thì gửi kèm ảnh khoanh vùng giúp anh." },
      { by: "acc2", gap: 1, text: "Dạ ok anh." }
    ]
  },
  {
    where: { group: "g-khach-kho" },
    date: "2026-09-16",
    time: "12:40",
    lines: [
      {
        by: "acc2",
        text: "Agency Mỹ phản hồi 12 ảnh trời bị ám tím 😥",
        files: [{ name: "phan-hoi-troi-am-tim.jpg", hint: "ảnh khách khoanh đỏ vùng trời bị ám tím" }],
        react: { "😮": ["acc1"] },
        thread: [
          { by: "khoa", gap: 6, text: "Anh xem rồi, do preset trời cũ chỉnh hue bị lệch. @{lead1} cho làm lại bằng preset v3 nhé." },
          { by: "lead1", gap: 3, text: "Ok anh, 2 bạn làm, khoảng 15h xong." },
          { by: "acc2", gap: 2, text: "Em báo khách trả lại trong 3 tiếng nha." }
        ]
      },
      { by: "acc1", gap: 60, text: "Mình báo sếp rồi, sếp dặn gửi kèm lời xin lỗi và lần sau tặng khách 10 ảnh miễn phí.", react: { "👍": ["khoa", "acc2"] } }
    ]
  },
  {
    where: { group: "g-khach-kho" },
    date: "2026-09-24",
    time: "14:00",
    lines: [
      { by: "lead1", text: "Job 120 ảnh khách Úc yêu cầu kéo cửa sổ thấy rõ cảnh ngoài, mà ảnh gốc cháy sáng hết, không có bracket tối. Tính sao đây?" },
      { by: "khoa", gap: 6, text: "Không có bracket thì không kéo thật được. @{acc1} hỏi khách gửi thêm bracket, hoặc đồng ý thay cảnh ngoài cửa sổ nhé." },
      { by: "acc1", gap: 3, text: "Để mình hỏi, chắc khách chọn thay cảnh." },
      { by: "acc1", gap: 40, text: "Khách đồng ý thay cảnh ngoài cửa sổ, miễn nhìn tự nhiên là được.", react: { "👍": ["lead1", "khoa"] } },
      { by: "lead1", gap: 2, text: "Ok, triển khai." }
    ]
  },
  {
    where: { group: "g-khach-kho" },
    date: "2026-10-06",
    time: "10:15",
    lines: [
      {
        by: "khoa",
        text: "Lưu ý khách Nhật:\n\n- Viền sản phẩm sai lệch tối đa 1px\n- Nền trắng tuyệt đối `#FFFFFF`\n- Giữ path trong file PSD\n\nHướng dẫn chi tiết anh đã đính trong dự án.",
        react: { "👀": ["acc2"], "✅": ["lead1"] }
      },
      { by: "acc2", gap: 8, text: "Dạ còn bóng đổ thì khách muốn giữ hay bỏ ạ?" },
      {
        by: "acc1",
        gap: 3,
        text: "Giữ bóng tự nhiên, nhẹ thôi. Ảnh mẫu đây.",
        files: [{ name: "mau-bong-do-khach-Nhat.jpg", hint: "ảnh sản phẩm giày trên nền trắng với bóng đổ nhẹ tự nhiên" }]
      },
      { by: "lead1", gap: 4, text: "Ok, mình phổ biến cho nhóm 4 bạn cut-out." }
    ]
  },
  {
    where: { group: "g-khach-kho" },
    date: "2026-10-09",
    time: "18:30",
    lines: [
      { by: "acc1", text: "Lô thử khách Nhật đã gửi lúc 17h45. Cảm ơn mọi người 🙏", react: { "🙏": ["khoa"], "🎉": ["lead1", "acc2"] } },
      { by: "khoa", gap: 6, text: "Anh soát ngẫu nhiên 20 ảnh trước khi gửi, viền ổn. Giờ chờ khách phản hồi thôi." }
    ]
  },
  {
    where: { group: "g-khach-kho" },
    date: "2026-10-10",
    time: "14:00",
    lines: [
      {
        by: "acc2",
        text: "Khách Nhật phản hồi rồi: đạt 97%, 6 ảnh cần chỉnh lại viền tóc người mẫu ạ.",
        files: [{ name: "khach-Nhat-phan-hoi-6-anh.png", hint: "6 ảnh sản phẩm thời trang có ghi chú khoanh vùng viền tóc cần sửa" }],
        thread: [
          { by: "khoa", gap: 8, text: "Anh xem rồi, viền tóc bị cứng. @{lead1} phần tóc cho dùng mask theo kênh màu thay vì pen tool nhé." },
          { by: "lead1", gap: 3, text: "Ok anh, tối nay sửa xong." }
        ]
      },
      { by: "acc1", gap: 10, text: "@{khoa} khách hỏi luôn mình nhận được 300 ảnh/tháng từ tháng 11 không, mình trả lời được chứ?" },
      { by: "khoa", gap: 4, text: "Được, nếu giữ nhóm 4 bạn cố định và có thêm 2 bạn dự phòng." },
      { by: "lead1", gap: 2, text: "Ca A đang test thêm 1 bạn cho nhóm này rồi nha.", react: { "👍": ["acc1", "khoa"] } }
    ]
  },

  // ═══════════════════════════════ GROUP: g-teambuilding (admin, linh, an, nv02, nv09) — until 09-27 ═══════════════════════════════
  {
    where: { group: "g-teambuilding" },
    date: "2026-09-03",
    time: "10:30",
    lines: [
      { by: "admin", text: "Nhóm ban tổ chức team building đây mọi người ơi! Chốt đi **Vũng Tàu 26–27/9** nha.", react: { "🎉": ["an", "nv02", "nv09"] } },
      { by: "linh", gap: 4, text: "Chia việc nhé:\n\n- @{admin} lo xe và khách sạn\n- @{an} lo áo đồng phục, backdrop\n- @{nv02} @{nv09} lo trò chơi và gala tối" },
      { by: "nv02", gap: 3, text: "Dạ ok chị, em với @{nv09} lên kịch bản trò chơi bãi biển ạ." },
      { by: "nv09", gap: 2, text: "Em lo thêm loa đài với mic cho gala luôn nha 🎤" }
    ]
  },
  {
    where: { group: "g-teambuilding" },
    date: "2026-09-08",
    time: "15:00",
    lines: [
      {
        by: "an",
        text: "Mẫu áo đồng phục em làm 2 màu, mọi người vote nha.",
        files: [
          { name: "ao-dong-phuc-mau-xanh.png", hint: "mẫu áo thun đồng phục màu xanh dương, logo nhỏ trước ngực" },
          { name: "ao-dong-phuc-mau-cam.png", hint: "mẫu áo thun đồng phục màu cam, chữ team building sau lưng" }
        ],
        react: { "🔥": ["nv02", "nv09"] },
        thread: [
          { by: "nv02", gap: 5, text: "Màu cam nổi trên nền biển, chụp ảnh đẹp nè." },
          { by: "nv09", gap: 2, text: "Cam +1" },
          { by: "linh", gap: 10, text: "Cam nhé, chốt!", react: { "🎉": ["an"] } }
        ]
      },
      { by: "admin", gap: 20, text: "Em gửi form đăng ký size áo, hạn chót thứ 6 nha mọi người: [Đăng ký size áo](https://nesso.example/forms/size-ao-team-building)" }
    ]
  },
  {
    where: { group: "g-teambuilding" },
    date: "2026-09-16",
    time: "17:30",
    lines: [
      { by: "admin", text: "Cập nhật: đã đặt xe 45 chỗ và khách sạn 12 phòng đôi gần bãi Sau ạ.", react: { "👍": ["linh", "an"] } },
      { by: "linh", gap: 5, text: "Tuần này đơn Úc dồn, nhớ chừa phương án ca trực cuối tuần 26–27 nha." },
      { by: "admin", gap: 3, text: "Dạ ca trực sẽ có 4 bạn tự nguyện, công ty gửi phần quà riêng cho các bạn ạ." },
      { by: "nv09", gap: 4, text: "Bạn nào trong ca trực muốn đổi lịch thì nhắn em, em hỗ trợ ghép đổi nha." }
    ]
  },
  {
    where: { group: "g-teambuilding" },
    date: "2026-09-22",
    time: "11:00",
    lines: [
      {
        by: "nv02",
        text: "Kịch bản trò chơi em gửi ạ: kéo co, truyền nước, đua thuyền phao, tối gala có bốc thăm trúng thưởng.",
        files: [{ name: "kich-ban-tro-choi-Vung-Tau.docx", hint: "kịch bản trò chơi bãi biển và chương trình gala tối" }]
      },
      { by: "linh", gap: 6, text: "Hay đó em. Phần quà bốc thăm để chị lo.", react: { "❤️": ["nv02"] } },
      { by: "an", gap: 3, text: "Backdrop gala em in xong thứ 5 nha." },
      { by: "admin", gap: 4, text: "Xe xuất phát 6h sáng thứ 7 tại công ty, mọi người nhắc nhau đi đúng giờ ạ." },
      { by: "nv09", gap: 5, text: "Em thử loa kéo rồi, ổn áp luôn ạ 👌" }
    ]
  },
  {
    where: { group: "g-teambuilding" },
    date: "2026-09-25",
    time: "18:30",
    lines: [
      {
        by: "admin",
        text: "Checklist trước khi đi:\n\n[x] Xe 45 chỗ\n[x] Khách sạn\n[x] Áo đồng phục (đã phát)\n[ ] Thuốc say xe, kem chống nắng\n[ ] Danh sách chia phòng",
        edited: "Checklist trước khi đi:\n\n[x] Xe 45 chỗ\n[x] Khách sạn\n[x] Áo đồng phục (đã phát)\n[x] Thuốc say xe, kem chống nắng\n[ ] Danh sách chia phòng"
      },
      { by: "linh", gap: 4, text: "Thuốc say xe với kem chống nắng chị mua rồi nhé." },
      { by: "admin", gap: 2, text: "Dạ em tick luôn ạ ✅ Danh sách chia phòng tối nay em gửi." },
      { by: "nv02", gap: 3, text: "Mai 5h30 em có mặt ở công ty phụ chất đồ lên xe nha.", react: { "👏": ["linh"] } }
    ]
  },
  {
    where: { group: "g-teambuilding" },
    date: "2026-09-26",
    time: "21:00",
    lines: [
      {
        by: "nv02",
        text: "Gala vui quá mọi người ơi 🎉",
        files: [{ name: "gala-Vung-Tau.jpg", hint: "cả nhóm mặc áo cam trong buổi gala tối bên biển" }],
        react: { "❤️": ["linh", "an", "admin", "nv09"] }
      },
      { by: "an", gap: 4, text: "Ảnh đẹp quá, về em làm album cho cả công ty nha." },
      { by: "nv09", gap: 3, text: "Loa không trục trặc lần nào luôn 😎" },
      { by: "linh", gap: 5, text: "Cảm ơn ban tổ chức nhé, mọi người vất vả rồi ❤️", react: { "❤️": ["admin", "nv02"] } }
    ]
  },
  {
    where: { group: "g-teambuilding" },
    date: "2026-09-27",
    time: "18:30",
    lines: [
      { by: "admin", text: "Xe về tới công ty an toàn rồi ạ. Cảm ơn mọi người đã đồng hành!", react: { "🙏": ["linh"], "👏": ["an", "nv02"] } },
      { by: "nv09", gap: 6, text: "Mai đi làm mà chân còn dính cát 😂", react: { "😂": ["nv02", "an"] } }
    ]
  }
];
