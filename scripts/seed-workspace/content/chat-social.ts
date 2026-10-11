import type { ChatScene } from "../types.js";

/**
 * Chat scenes for #tan-gau, #team-building-thang-9 (archived 2026-09-28) and #ban-dieu-hanh (private).
 * INVENTED content for a local test-data seed only — no real people, clients, prices or contacts.
 */
export const scenesSocial: ChatScene[] = [
  // ════════════════════════════════════════ #tan-gau ════════════════════════════════════════
  {
    where: { channel: "tan-gau" }, date: "2026-08-25", time: "11:40",
    lines: [
      { by: "nv03", text: "Ơ kênh tán gẫu có rồi nè, từ nay khỏi lập group Zalo ăn trưa nữa 😆", react: { "😂": ["nv05", "nv08", "an"] } },
      { by: "nv08", text: "Trưa nay ăn gì đây mọi người, em đói từ 10h rồi 🥲" },
      { by: "an", text: "Cơm tấm đầu hẻm đi, quán mới sơn lại bảng hiệu nhìn sạch sẽ ghê" },
      { by: "nv05", text: "Cơm tấm +1" },
      { by: "nv11", text: "Em thèm bún bò, có ai đi chung không" },
      {
        by: "boss",
        text: "Kênh này để anh em nói chuyện ngoài lề cho vui nhé, việc thì qua các kênh kia. Ăn trưa ngon miệng cả nhà 😄",
        react: { "❤️": ["linh", "admin", "nv03", "nv08", "an"], "👍": ["lead1", "nv11"] }
      },
      {
        by: "nv03", text: "Dạ sếp 😁 vậy chốt 4 người cơm tấm, 2 người bún bò nha",
        edited: "Dạ sếp 😁 vậy chốt 5 người cơm tấm, 2 người bún bò nha"
      },
      { by: "nv08", text: "Ok 11h50 gặp dưới sảnh nhé", react: { "👍": ["nv05", "an"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-08-26", time: "14:50",
    lines: [
      {
        by: "nv07", text: "Chiều nay đặt trà sữa không mọi người? Quán góc đường đang mua 2 tặng 1 🧋",
        react: { "🔥": ["nv03", "nv12"] },
        thread: [
          { by: "nv03", text: "Em 1 trà sữa trân châu đường đen, ít đá", gap: 2 },
          { by: "nv05", text: "Cho em 1 hồng trà macchiato, 50% đường" },
          { by: "khoa", text: "Anh 1 cà phê muối nếu quán có" },
          { by: "nv07", text: "Chốt 7 ly, 15h15 quán giao. Mọi người đưa tiền mặt hoặc chuyển khoản cho em sau nha", react: { "👍": ["nv03", "nv05"] } }
        ]
      },
      { by: "nv12", text: "Mua 2 tặng 1 thì ly thứ 3 ai uống đây 😂", gap: 4 },
      { by: "khoa", text: "Ly thứ 3 để QC kiểm tra chất lượng 🤓", react: { "😂": ["nv07", "nv12", "an", "nv03"] } },
      { by: "nv07", text: "Trà sữa tới rồi, ai đặt xuống sảnh lấy nha 🛵", gap: 25, react: { "🎉": ["nv03", "nv05", "nv12"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-08-27", time: "17:05",
    lines: [
      {
        by: "lead2", text: "Tối nay thứ 5 đá bóng sân mini cũ nha anh em ⚽ 19h có mặt. Ai đi điểm danh trong thread 👇",
        react: { "👍": ["nv01", "nv06", "nv10", "minh", "loc"] },
        thread: [
          { by: "nv01", text: "Em đi, em mang thêm bộ áo bib", gap: 3 },
          { by: "minh", text: "Anh đi, nhưng tới trễ 15 phút do còn cài máy cho ca chiều" },
          { by: "loc", text: "Em đi nha, thiếu thủ môn thì em bắt" },
          { by: "lead2", text: "Đủ 2 đội 5 người rồi, chốt nhé ✅" }
        ]
      },
      { by: "khoa", text: "Đá xong mai nhớ đi làm đúng giờ, đừng trẹo chân như tháng trước 😅", gap: 6, react: { "😂": ["nv06", "loc"] } },
      { by: "nv10", text: "Năm nay em quyết giảm 3kg nhờ đá bóng 💪" },
      { by: "lead2", text: "@{boss} tối nay anh có ra sân không ạ?" },
      { by: "boss", text: "Tối nay anh có hẹn rồi, tuần sau anh ra. Đá vui, nhớ khởi động kỹ nhé 👍", gap: 12, react: { "❤️": ["lead2", "nv10"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-08-29", time: "17:30",
    lines: [
      {
        by: "nv04", text: "Mưa to quá trời, đường trước công ty bắt đầu ngập rồi 😩",
        files: [{ name: "mua-truoc-cong-ty.jpg", hint: "street outside the office flooding in heavy afternoon rain, motorbikes wading" }],
        react: { "😮": ["nv01", "nv02", "an", "linh"] }
      },
      { by: "nv01", text: "Ca chiều tụi em về 22h chắc nước rút rồi ha" },
      { by: "linh", text: "Ca sáng đợi ngớt mưa hẵng về nhé, đừng cố chạy qua chỗ ngập, chết máy xe khổ lắm", react: { "🙏": ["nv04", "nv06", "nv11"] } },
      { by: "nv06", text: "Mặc áo mưa bộ mà vẫn ướt hết 😢" },
      { by: "admin", text: "Pantry còn mì gói với cà phê, ai kẹt mưa cứ lên dùng nhé", react: { "❤️": ["nv04", "nv06", "nv11", "nv01"] } },
      { by: "nv11", text: "Hành chính chu đáo quá 🙏" },
      { by: "nv04", text: "Ngớt rồi, em về đây. Ngã tư phía trước còn ngập nhẹ, mọi người đi đường vòng nha", gap: 40, react: { "👍": ["linh"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-08-31", time: "10:15",
    lines: [
      {
        by: "nv06", text: "Cuối tuần em trốn lên Đà Lạt 2 ngày, trời lạnh mê luôn 🌲",
        files: [
          { name: "da-lat-doi-thong.jpg", hint: "pine hill covered in morning fog" },
          { name: "da-lat-quan-ca-phe.jpg", hint: "coffee shop terrace overlooking a green valley" },
          { name: "da-lat-cho-dem.jpg", hint: "night market street food stalls with warm lights" }
        ],
        react: { "❤️": ["an", "nv03", "nv09", "linh"], "🔥": ["nv10"] },
        thread: [
          { by: "an", text: "Ảnh đẹp ghê, sương kiểu này mà đem làm sky replacement thì khỏi chỉnh 😂", gap: 4 },
          { by: "nv06", text: "Haha chụp điện thoại thôi á 😆" },
          { by: "khoa", text: "Ảnh thứ 2 đường chân trời nghiêng 1 độ, QC trả về nhé 🤓", react: { "😂": ["nv06", "an", "nv09"] } },
          { by: "nv06", text: "Anh Khoa nghỉ cuối tuần giùm em 😭" }
        ]
      },
      { by: "nv09", text: "Ghen tị ghê, cuối tuần em ở nhà ngủ bù ca đêm", gap: 8 },
      { by: "nv03", text: "Cuối tháng 9 đi Vũng Tàu team building rồi, ráng chờ nha 😁" },
      { by: "boss", text: "Ảnh đẹp đấy. Đi chơi nạp năng lượng rồi tuần này chiến đơn nhé 😄", react: { "👍": ["nv06", "nv09"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-01", time: "12:05",
    lines: [
      { by: "lead1", text: "Điểm danh ca trực lễ 2/9 nè: ca A có 6 bạn. Trưa ăn gì để mình đặt chung?" },
      { by: "nv01", text: "Em ăn gì cũng được, miễn có cơm 😅" },
      { by: "nv07", text: "Em gà xối mỡ" },
      { by: "nv12", text: "Ngày lễ ngồi thay trời xanh cho nhà bên Úc, thôi cũng vui 😂" },
      {
        by: "boss", text: "Cảm ơn anh em trực lễ nhé. Bữa trưa hôm nay và mai công ty bao, @{admin} đặt giúp anh",
        react: { "❤️": ["lead1", "nv01", "nv07", "nv12", "nv14"], "🎉": ["nv01", "nv12"] }
      },
      { by: "admin", text: "Dạ em đặt liền ạ. @{lead1} gửi em số phần với món nhé" },
      { by: "lead1", text: "6 phần: 3 gà xối mỡ, 2 cơm sườn, 1 cơm chay nha", react: { "👍": ["admin"] } },
      { by: "nv14", text: "Cơm tới rồi, cảm ơn sếp với hành chính 🙏", gap: 45, react: { "❤️": ["boss", "admin"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-03", time: "16:40",
    lines: [
      { by: "lead2", text: "Thứ 5 rồi anh em ơi ⚽ Tối nay 19h sân cũ, ai đi thả 👍 vào tin này nhé", react: { "👍": ["nv01", "nv06", "nv10", "loc", "minh", "boss"] } },
      { by: "boss", text: "Hôm nay anh ra sân nhé, đội nào thiếu người thì anh vào", react: { "🔥": ["lead2", "nv10", "loc"] } },
      { by: "nv10", text: "Sếp đá cánh nào ạ, để em né 😂", react: { "😂": ["nv06", "loc", "nv01"] } },
      { by: "boss", text: "Đá đâu cũng được, chủ yếu chạy cho ra mồ hôi 😄" },
      { by: "nv08", text: "Em ca chiều xin vắng, đội nào thắng kể em nghe với" },
      {
        by: "minh", gap: 290,
        text: "Kết quả: đội áo xanh thắng 6–4, sếp ghi 1 bàn 👏",
        edited: "Kết quả: đội áo xanh thắng 6–4, sếp ghi 2 bàn 👏 (xin lỗi sếp, nãy đếm thiếu 😅)",
        files: [{ name: "da-bong-thu-5.jpg", hint: "office football team group photo on a floodlit mini pitch at night" }],
        react: { "👏": ["lead2", "nv01", "loc", "nv06", "nv10", "linh"], "😂": ["boss"] }
      }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-04", time: "10:20",
    lines: [
      {
        by: "nv07", text: "Mọi người ơi có con mèo vàng nằm trên máy in tầng 2 nè 😳",
        files: [{ name: "meo-tren-may-in.jpg", hint: "orange tabby cat sleeping on top of an office printer" }],
        react: { "😮": ["nv03", "nv12", "an"], "❤️": ["linh", "nv02", "nv05"] },
        thread: [
          { by: "admin", text: "Để mình hỏi bảo vệ tòa nhà xem mèo nhà ai nha", gap: 3 },
          { by: "admin", text: "Bảo vệ nói mèo hoang quanh khu này, mấy hôm nay hay vào chỗ ấm ngủ", gap: 15 },
          { by: "an", text: "Đặt tên Mướp đi 😆", react: { "👍": ["nv03", "nv07"] } },
          { by: "minh", text: "Miễn đừng nằm trên switch mạng là được 😅", react: { "😂": ["nv07", "an", "admin"] } }
        ]
      },
      { by: "nv12", text: "Nó ngủ ngon hơn em nữa 😴", gap: 5 },
      { by: "khoa", text: "Máy in đang in checklist QC mà nó nằm chặn khay giấy 😂", react: { "😂": ["nv07", "nv12"] } },
      { by: "linh", text: "Cho bé ở tạm cũng được, nhưng mọi người nhớ đóng cửa phòng máy chủ nhé" },
      { by: "nv07", text: "Dạ em mua gói hạt cho Mướp rồi 🐱", react: { "❤️": ["nv03", "an", "nv05", "nv12"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-08", time: "17:15",
    lines: [
      { by: "nv03", text: "Mọi người có ai nhớ mai là ngày gì không 🤫 ai biết thì nhắn riêng em nha" },
      { by: "nv04", text: "Ủa mai là ngày gì vậy 👀" },
      { by: "nv03", text: "Không có gì đâu, thứ 4 bình thường thôi 😇", react: { "😂": ["nv05", "nv07", "nv12", "an"] } },
      { by: "nv07", text: "Đúng rồi, ngày bình thường, không có bánh kem gì đâu 🙈", react: { "😂": ["nv03", "nv04"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-09", time: "08:40",
    lines: [
      {
        by: "nv03", text: "🎂 Chúc mừng sinh nhật @{nv04}! Tuổi mới chỉnh ảnh nhanh, ít bị trả sửa, lương tăng đều nha 🎉",
        react: { "🎉": ["nv04", "nv05", "nv07", "an", "linh", "lead1"], "❤️": ["nv04", "nv02"] },
        thread: [
          { by: "nv04", text: "Thì ra hôm qua giả bộ đó hả 😂 cảm ơn mọi người nhiều nha", gap: 4 },
          { by: "lead1", text: "Chúc em tuổi mới vui vẻ, khỏe mạnh. Chiều nay ca A có bánh nhé" },
          { by: "khoa", text: "Chúc mừng sinh nhật, tuổi mới 0 lỗi halo 😄" },
          { by: "nv04", text: "Dạ em cảm ơn anh Khoa, em hứa không để halo nữa ạ 🙏", react: { "😂": ["khoa"] } }
        ]
      },
      { by: "linh", text: "Chúc mừng sinh nhật em nhé, tuổi mới thật nhiều niềm vui!", gap: 6, react: { "❤️": ["nv04"] } },
      {
        by: "boss", text: "Happy birthday @{nv04} 🎉 Chúc em tuổi mới sức khỏe, giữ vững phong độ tay nghề nhé",
        react: { "❤️": ["nv04", "nv03", "lead1"], "🎉": ["nv07"] }
      },
      { by: "nv04", text: "Dạ em cảm ơn anh ạ 🥰" },
      { by: "an", text: "Chúc mừng sinh nhật nha! 🎂🎈" },
      { by: "nv07", text: "Mướp cũng gửi lời chúc mừng sinh nhật 🐱", react: { "😂": ["nv04", "nv12"] } },
      {
        by: "nv03", text: "Thổi nến lúc 15h30 nè cả nhà", gap: 400,
        files: [{ name: "sinh-nhat-9-9.jpg", hint: "office birthday cake with lit candles, colleagues clapping around a desk" }],
        react: { "❤️": ["nv04", "boss", "linh", "nv05", "nv12"], "🎉": ["lead1", "an"] }
      },
      { by: "nv04", text: "Cảm ơn cả nhà vì chiếc bánh với bài hát lạc tông 😂❤️", react: { "😂": ["nv03", "nv07", "nv12"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-10", time: "16:30",
    lines: [
      {
        by: "lead2", text: "Tối nay đá bóng là trận cuối của @{loc} trước khi chuyển đi nha, ai đi được thì ra đông đủ ⚽",
        react: { "😢": ["nv06", "nv10", "nv01"], "👍": ["minh", "nv08"] }
      },
      { by: "loc", text: "Dạ trận chia tay, em đá hết sức luôn 😂" },
      { by: "nv06", text: "Tối nay cho Lộc đá tiền đạo luôn" },
      { by: "nv10", text: "Thua thì Lộc bao nước, thắng thì đội kia bao 😆", react: { "😂": ["loc", "nv06"] } },
      { by: "minh", text: "Nhớ mang áo khoác, dự báo tối có mưa" },
      {
        by: "lead2", text: "Trận cuối hoà 5–5, Lộc ghi bàn gỡ phút chót 👏", gap: 280,
        files: [{ name: "tran-chia-tay.jpg", hint: "football team group photo at night, one player holding the ball in the center" }],
        react: { "👏": ["loc", "nv06", "nv10", "minh", "nv01"], "❤️": ["linh", "an"], "😢": ["nv08"] }
      }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-11", time: "09:00",
    lines: [
      {
        by: "linh",
        text: "Mai là ngày làm việc cuối của @{loc} trước khi em chuyển ra Đà Nẵng sống gần gia đình 😢 Chiều nay 17h mình làm buổi chia tay nhỏ ở pantry, mọi người sắp xếp ghé nhé",
        react: { "😢": ["nv06", "nv10", "nv01", "an", "nv04"], "❤️": ["loc", "boss"] }
      },
      { by: "loc", text: "Dạ sắp đi thấy buồn ghê mọi người ơi 🥲" },
      { by: "nv06", text: "Đi rồi ai đá hậu vệ cho tụi em 😭" },
      { by: "khoa", text: "Em là một trong những bạn ít lỗi nhất năm nay đó. Đi đâu cũng nhớ giữ chuẩn nhé" },
      { by: "loc", text: "Dạ em cảm ơn anh Khoa, bị anh trả bài nhiều nên mới lên tay đó ạ 😅", react: { "😂": ["khoa", "nv04", "nv06"] } },
      { by: "admin", text: "17h pantry có bánh với trà sữa, ca chiều tranh thủ ghé 5–10 phút nhé" }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-11", time: "17:15",
    lines: [
      {
        by: "an", text: "Ảnh chia tay Lộc nè mọi người 📸",
        files: [
          { name: "chia-tay-loc-1.jpg", hint: "farewell party in the office pantry, group photo with a bouquet" },
          { name: "chia-tay-loc-2.jpg", hint: "colleague holding a large farewell card signed by the team" }
        ],
        react: { "❤️": ["loc", "linh", "boss", "nv06", "nv10", "admin"], "😢": ["nv01", "nv08"] },
        thread: [
          { by: "nv10", text: "Tấm 2 Lộc khóc kìa 😂", gap: 3 },
          { by: "loc", text: "Bụi bay vào mắt thôi mà 😤" },
          { by: "nv06", text: "Bụi gì bay đúng lúc phát biểu vậy 😂", react: { "😂": ["loc", "nv10", "an"] } }
        ]
      },
      {
        by: "loc", gap: 5,
        text: "Em cảm ơn anh chị và các bạn nhiều lắm 🙏 Hơn 2 năm ở đây em học được rất nhiều, từ blend HDR tới chịu deadline 4h sáng 😅 Có dịp vô Sài Gòn em sẽ ghé thăm mọi người. Nhớ giữ liên lạc nha ❤️",
        react: { "❤️": ["boss", "linh", "khoa", "lead1", "nv06", "an"], "🙏": ["nv10", "nv04"] }
      },
      {
        by: "boss",
        text: "Cảm ơn Lộc vì những năm gắn bó. Ở đâu cũng nhớ công ty vẫn là nhà, cần gì cứ nhắn anh. Chúc em lên đường bình an 🙏",
        react: { "❤️": ["loc", "linh", "nv06", "nv10"] }
      },
      { by: "lead1", text: "Đi mạnh giỏi nha em, ca A sẽ nhớ em lắm" },
      { by: "loc", text: "Dạ em cảm ơn sếp, cảm ơn trưởng ca, em sẽ nhớ mọi người lắm 🥹", react: { "❤️": ["boss", "lead1", "an"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-14", time: "21:40",
    lines: [
      { by: "nv12", text: "Ca đêm điểm danh 🙋 tối nay khách Úc đổ đơn dữ quá" },
      { by: "nv14", text: "Có ai đói không, em định đặt cháo lòng" },
      { by: "lead2", text: "Cho mình 1 phần, thêm quẩy nha" },
      { by: "nv01", text: "Em 1 bánh mì chảo nha" },
      {
        by: "boss", gap: 8,
        text: "Tuần này anh em ca đêm vất vả, đồ ăn khuya cả tuần công ty lo nhé. Cứ đặt rồi gửi hoá đơn cho @{admin}",
        react: { "❤️": ["nv12", "nv14", "lead2", "nv01"], "🎉": ["nv12", "nv14"], "🙏": ["lead2"] }
      },
      { by: "nv14", text: "Khuya rồi sếp đi ngủ đi ạ 😂 em cảm ơn sếp nhiều", react: { "😂": ["nv12", "nv01"] } },
      { by: "boss", text: "Anh đang xem số đơn nên còn thức 😄 Làm xong nhớ nghỉ đúng giờ nhé", react: { "👍": ["lead2"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-16", time: "14:30",
    lines: [
      {
        by: "boss", text: "Mấy hôm nay đơn dồn, chiều nay anh mời cả nhà trà sữa. @{nv07} gom order giúp anh nhé 🧋",
        react: { "🎉": ["nv07", "nv03", "nv05", "nv12", "an", "nv09"], "❤️": ["linh", "lead1"] },
        thread: [
          { by: "nv07", text: "Dạ em gom liền ạ! Mọi người reply món ngay đây nha", gap: 2 },
          { by: "nv03", text: "Trân châu đường đen ít đá như cũ ạ" },
          { by: "khoa", text: "Anh 1 cà phê muối nhé" },
          { by: "lead1", text: "Ca A 8 người mình gom riêng gửi @{nv07} sau nhé" },
          {
            by: "nv07", text: "Chốt 26 ly, 15h30 giao ạ ✅",
            edited: "Chốt 27 ly (thêm 1 ly cho sếp), 15h30 giao ạ ✅",
            react: { "👍": ["boss"] }
          }
        ]
      },
      { by: "nv05", text: "Sếp tâm lý quá 😭 đang buồn ngủ thì có trà sữa", gap: 5 },
      { by: "nv12", text: "Uống xong chắc blend thêm được 50 ảnh 😂", react: { "😂": ["boss", "nv05"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-17", time: "17:00",
    lines: [
      { by: "lead2", text: "Tuần này hoãn đá bóng nha anh em, đơn Úc còn nhiều, ai cũng đang tăng ca 😢", react: { "😢": ["nv06", "nv10", "minh"] } },
      { by: "nv10", text: "Buồn ghê, đang lên form" },
      { by: "minh", text: "Thứ 5 tuần sau đá bù 2 hiệp 😄" },
      { by: "nv06", text: "Thôi đá bóng bàn phím vậy 🥲", react: { "😂": ["nv10"] } },
      {
        by: "boss", text: "Xong đợt cao điểm này anh mời cả đội đá bóng xong đi ăn lẩu nhé",
        react: { "🔥": ["lead2", "nv10", "nv06", "minh"], "🎉": ["nv01"] }
      }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-19", time: "17:40",
    lines: [
      {
        by: "nv02", text: "Lại ngập nữa rồi mọi người ơi 😩",
        files: [{ name: "ngap-nga-tu.jpg", hint: "flooded intersection at dusk, water up to motorbike wheels" }],
        react: { "😮": ["nv05", "nv11", "linh", "an"] }
      },
      { by: "nv11", text: "Nước lên tới bánh xe rồi, ai về hướng cầu thì đi đường khác nha" },
      { by: "linh", text: "Ca sáng nếu chưa về thì ngồi đợi thêm chút nhé. An toàn là trên hết", react: { "🙏": ["nv02", "nv11", "nv05"] } },
      { by: "nv05", text: "Em đợi thêm 30 phút, tiện làm nốt 5 ảnh 😂" },
      { by: "nv11", text: "Ca B ơi file trả sửa đợt 3 em để trong thư mục chung rồi nha", deleted: true },
      { by: "nv11", text: "Ơ nhầm kênh 😅", gap: 1, react: { "😂": ["nv05", "nv02"] } },
      {
        by: "boss",
        text: "Ai về xa mà đường ngập sâu thì cứ ở lại công ty chờ nước rút, tối nay công ty đặt cơm cho ai kẹt lại nhé",
        react: { "❤️": ["nv02", "nv11", "nv05", "nv13"] }
      },
      { by: "nv02", text: "Em về tới nhà rồi, đường vòng xa mà khô 😌", gap: 45, react: { "👍": ["linh"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-21", time: "10:30",
    lines: [
      {
        by: "nv07", text: "Cuối tuần IT chuyển NAS mới, sáng nay Mướp lên nằm ngay nóc tủ server mới 😂 chắc thấy ấm",
        files: [{ name: "muop-tren-tu-server.jpg", hint: "orange cat curled up on top of a new server rack cabinet" }],
        react: { "😂": ["minh", "nv03", "an", "nv12", "nv05"], "❤️": ["linh"] },
        thread: [
          { by: "minh", text: "Mướp đang giám sát phân quyền thư mục giúp anh 😑", gap: 6 },
          { by: "nv12", text: "Thảo nào sáng nay em mở thư mục không được 😂" },
          { by: "minh", text: "Cái đó lỗi phân quyền, không phải lỗi Mướp nha, anh đang sửa 😅", react: { "😂": ["nv12", "nv07", "an"] } }
        ]
      },
      { by: "an", text: "Mướp ăn ảnh ghê, cho làm mascot fanpage luôn", gap: 4 },
      { by: "nv03", text: "Mascot Nesso: Mướp – chuyên gia nằm sưởi 😆", react: { "😂": ["an", "nv07"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-23", time: "08:45",
    lines: [
      {
        by: "admin", text: "🎂 Hôm nay sinh nhật chị @{linh}! Cả nhà vào chúc mừng chị nào 🎉",
        react: { "🎉": ["boss", "an", "nv02", "nv09", "khoa", "lead1"], "❤️": ["linh", "hanh"] },
        thread: [
          { by: "an", text: "Chúc mừng sinh nhật chị Linh, tuổi mới xinh đẹp, bớt deadline nha chị 💐", gap: 3 },
          { by: "hanh", text: "Em chúc chị Linh sinh nhật vui vẻ, luôn rạng rỡ như mọi ngày ạ 🌸" },
          { by: "khoa", text: "Chúc mừng sinh nhật chị, tuổi mới dự án nào cũng đúng hạn" },
          { by: "linh", text: "Cảm ơn cả nhà nha, đọc mà thấy vui cả ngày 🥰", react: { "❤️": ["an", "hanh"] } }
        ]
      },
      {
        by: "boss", gap: 10,
        text: "Chúc mừng sinh nhật @{linh}! Cảm ơn em đã gánh vận hành suốt thời gian qua, nhất là tuần đơn Úc vừa rồi. Tuổi mới sức khỏe, vui vẻ nhé 🎉",
        react: { "❤️": ["linh", "admin", "an", "khoa"], "👏": ["lead1", "lead2"] }
      },
      { by: "linh", text: "Em cảm ơn anh ạ 🙏 Có cả nhà nên em mới gánh nổi đó ạ" },
      { by: "lead2", text: "Chúc mừng sinh nhật chị Linh! Ca B xin góp phần bánh chiều nay 🎂" },
      { by: "nv02", text: "Happy birthday chị Linh 🎉" },
      {
        by: "admin", text: "15h45 cắt bánh ở phòng họp lớn nha mọi người", gap: 400,
        files: [{ name: "banh-sinh-nhat-chi-linh.jpg", hint: "birthday cake with a bouquet of flowers on the meeting room table" }],
        react: { "🎉": ["nv09", "nv02", "hanh"], "❤️": ["linh"] }
      },
      {
        by: "linh", text: "Cảm ơn mọi người vì bó hoa và chiếc bánh siêu to 😍 hôm nay là ngày vui nhất tuần!", gap: 60,
        react: { "❤️": ["boss", "admin", "an", "hanh", "nv02"] }
      }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-24", time: "16:50",
    lines: [
      { by: "lead2", text: "Đơn Úc xong đợt rồi, tối nay đá bóng bù nha anh em ⚽ 19h sân cũ", react: { "🔥": ["nv10", "nv06", "minh", "nv01", "nv14"] } },
      { by: "nv14", text: "Tuần này em ca sáng, cuối cùng cũng được đá 😭" },
      { by: "minh", text: "Đá 2 hiệp như đã hứa nhé" },
      { by: "nv10", text: "Đá xong về kịp xem đội tuyển đá giao hữu 21h luôn", react: { "👀": ["nv12"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-24", time: "21:50",
    lines: [
      { by: "nv12", text: "Ca đêm vừa chỉnh ảnh vừa nghe bình luận, đội tuyển đang dẫn 1–0 😆" },
      { by: "nv01", text: "Em mở livestream nhỏ xíu góc màn hình thôi 🙈" },
      { by: "lead2", text: "Màn hình chính vẫn phải là Photoshop nha 😂", react: { "😂": ["nv12", "nv01", "nv14"] } },
      { by: "nv10", text: "Vàooo 2–0 rồi!!!", react: { "🎉": ["nv12", "nv01", "nv14", "minh"], "🔥": ["nv06"] } },
      { by: "minh", text: "Đá bóng xong còn sức hò hét xem bóng, anh em khỏe thật" },
      { by: "nv12", text: "Hết trận 2–1, thắng rồi, giờ quay lại blend tiếp 😤", react: { "👍": ["lead2"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-25", time: "09:30",
    lines: [
      {
        by: "admin",
        text: "🥮 Trung thu rồi cả nhà ơi!\n- Bánh trung thu công ty tặng để ở pantry, mỗi người 1 hộp\n- Ca chiều và ca đêm mình để riêng, có dán tên\n- **16h30** liên hoan nhỏ ở sảnh, có lồng đèn và trà nóng 🏮",
        react: { "❤️": ["nv02", "nv05", "nv09", "hanh", "nv13", "lead1"], "🎉": ["an", "nv03"] },
        thread: [
          { by: "nv13", text: "Ca chiều lấy bánh luôn được không ạ hay đợi 13h30?", gap: 5 },
          { by: "admin", text: "Lấy lúc nào cũng được nha, bánh để tủ bên trái có dán tên ca" },
          { by: "hanh", text: "Lồng đèn có hình cá chép không ạ, em xin giành trước 😆" },
          { by: "admin", text: "Có 2 cái cá chép thôi, nhanh tay nhé 😄", react: { "😂": ["hanh"] } }
        ]
      },
      { by: "nv03", text: "Năm nay có nhân trứng muối không ạ 😋", gap: 6 },
      { by: "admin", text: "Có thập cẩm với đậu xanh trứng muối, ai thích nhân nào cứ đổi với nhau nha" },
      { by: "khoa", text: "Phe thập cẩm xin đổi với phe đậu xanh 🙋" },
      { by: "nv09", text: "Em đổi! Em mê đậu xanh", react: { "😂": ["khoa"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-25", time: "16:40",
    lines: [
      {
        by: "an", text: "Liên hoan Trung thu nè cả nhà 🏮",
        files: [
          { name: "trung-thu-sanh.jpg", hint: "office lobby mid-autumn party with lanterns and mooncakes" },
          { name: "trung-thu-long-den.jpg", hint: "colleagues holding colorful paper lanterns and smiling" }
        ],
        react: { "❤️": ["boss", "linh", "hanh", "nv02", "nv09", "nv05"], "🎉": ["admin", "nv03"] }
      },
      {
        by: "boss",
        text: "Trung thu vui vẻ cả nhà! Cảm ơn mọi người đã cùng công ty qua một tháng 9 rất bận. Mai đi Vũng Tàu nghỉ ngơi cho đã nhé 🏮",
        react: { "❤️": ["linh", "admin", "an", "lead1", "nv02"], "🎉": ["nv09"] }
      },
      { by: "hanh", text: "Lần đầu em được ăn Trung thu ở công ty, vui quá ạ 🥹", react: { "❤️": ["linh"] } },
      { by: "nv05", text: "Cái lồng đèn kéo quân quay đẹp ghê" },
      { by: "lead2", text: "Ca B tranh thủ ra ăn bánh 10 phút rồi vô lại nha 😄" },
      { by: "nv14", text: "Bánh dẻo ngon quá, ai không ăn cho em xin 🙋", react: { "😂": ["nv05", "an"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-28", time: "09:20",
    lines: [
      {
        by: "an",
        text: "📸 Album team building Vũng Tàu 26–27/9 đây cả nhà! Ảnh đầy đủ ở [thư mục chung](https://nesso.example/albums/team-building-vung-tau)",
        files: [
          { name: "vung-tau-ca-doan.jpg", hint: "whole company group photo on the beach wearing matching teal t-shirts" },
          { name: "vung-tau-gala.jpg", hint: "gala dinner by the sea with a small stage and string lights" },
          { name: "vung-tau-keo-co.jpg", hint: "tug of war on the sand, one team falling over laughing" }
        ],
        react: { "❤️": ["boss", "linh", "admin", "nv02", "nv09", "nv05"], "🎉": ["nv03", "lead1", "khoa"], "🔥": ["nv10"] },
        thread: [
          { by: "nv09", text: "Tấm kéo co đội đỏ ngã chổng vó đẹp nhất 😂", gap: 4 },
          { by: "nv02", text: "Tấm đó có em nè 😭 xin đừng làm ảnh bìa" },
          { by: "an", text: "Lỡ để làm ảnh bìa album rồi 😆" },
          { by: "khoa", text: "Ảnh cả đoàn đẹp, nhưng đường chân trời hơi nghiêng nha 😏", react: { "😂": ["an", "nv02", "nv09", "boss"] } },
          { by: "an", text: "Anh Khoa đi chơi cũng QC 😭" }
        ]
      },
      { by: "nv05", text: "Gala tối thứ 7 vui nhất, sếp hát hay quá trời 🎤", gap: 6, react: { "😂": ["nv03", "nv09"] } },
      {
        by: "boss", text: "Anh hát cho vui thôi 😄 Cảm ơn ban tổ chức @{admin} @{linh} @{an} @{nv02} @{nv09} nhé, chuyến đi rất chu đáo",
        react: { "❤️": ["admin", "linh", "an", "nv02", "nv09"], "👏": ["nv05", "nv03", "lead1"] }
      },
      {
        by: "nv10", text: "Về lại Sài Gòn đen thêm 2 tông 😂",
        edited: "Về lại Sài Gòn đen thêm 3 tông 😂 cần ai đó chỉnh white balance giùm",
        react: { "😂": ["nv06", "an", "khoa"] }
      },
      { by: "hanh", text: "Chuyến đi cuối cùng của em ở công ty mà đáng nhớ quá 🥹", react: { "❤️": ["linh", "an", "admin"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-09-29", time: "16:30",
    lines: [
      {
        by: "hanh",
        text: "Dạ mai là ngày cuối thực tập của em rồi ạ. Em cảm ơn chị Linh, anh Minh, An và mọi người đã hướng dẫn em suốt thời gian qua. Em học được rất nhiều về marketing và cả nghề chỉnh ảnh nữa 🥹 Mong có dịp gặp lại mọi người ❤️",
        react: { "❤️": ["linh", "an", "minh", "boss", "admin", "nv03"], "😢": ["nv05", "nv09"] },
        thread: [
          { by: "an", text: "Cảm ơn Hạnh nhiều nha, mấy bài fanpage tháng 9 là công của em đó 👏", gap: 4 },
          { by: "linh", text: "Em làm tốt lắm, cần thư giới thiệu hay giới thiệu việc thì nhắn chị nhé" },
          { by: "minh", text: "Chúc em bảo vệ thực tập điểm cao 😄" },
          { by: "hanh", text: "Dạ em cảm ơn mọi người ạ 🙏", react: { "❤️": ["an", "linh"] } }
        ]
      },
      {
        by: "boss", gap: 10,
        text: "Cảm ơn Hạnh. Em chăm chỉ và cầu tiến, ra trường nếu muốn quay lại thì cửa công ty luôn mở nhé 👍",
        react: { "❤️": ["hanh", "linh", "an"] }
      },
      { by: "hanh", text: "Dạ em cảm ơn anh nhiều ạ 🥹" },
      { by: "nv03", text: "Mai nhớ ghé pantry nha Hạnh, mọi người có quà nhỏ cho em 🎁", react: { "❤️": ["hanh", "nv05"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-01", time: "17:10",
    lines: [
      {
        by: "lead2", text: "Thứ 5 đá bóng nha anh em ⚽ Tuần này có người hứa bao lẩu sau trận đó nha @{boss} 😏",
        react: { "🔥": ["nv10", "nv06", "minh", "nv01", "nv14"], "😂": ["linh"] }
      },
      { by: "boss", text: "Anh nhớ mà 😄 Đá xong 21h anh em qua quán lẩu cũ, anh đặt bàn rồi", react: { "🎉": ["lead2", "nv10", "nv06", "nv14", "minh", "nv01"] } },
      { by: "nv08", text: "Hôm nay em đổi ca được nên đi luôn 🙋" },
      { by: "nv06", text: "Có lẩu là có động lực, tối nay em chạy cả 2 cánh" },
      {
        by: "minh", text: "Tỷ số 7–7, lẩu ngon, cảm ơn sếp 🙏", gap: 320,
        files: [{ name: "lau-sau-tran.jpg", hint: "hotpot dinner table with the football team after the match" }],
        react: { "🙏": ["lead2", "nv10", "nv06"], "❤️": ["boss", "linh"] }
      }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-02", time: "11:40",
    lines: [
      { by: "nv11", text: "Trưa thứ 6, ăn gì cho có không khí cuối tuần đây" },
      { by: "nv05", text: "Đi ăn cơm gà mới mở gần ngã tư đi" },
      { by: "nv15", text: "Em đi, nghe nói gà xé phay ngon lắm" },
      { by: "acc1", text: "Mình ăn sau nha, đang call với khách bên Úc 😩" },
      { by: "nv11", text: "Để tụi em mua mang về cho, muốn món gì nè?" },
      { by: "acc1", text: "Cơm gà xé, thêm canh nhé, cảm ơn em nhiều 🙏", react: { "👍": ["nv11"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-05", time: "10:30",
    lines: [
      {
        by: "nv12", text: "Ting ting 💸 lương tháng 9 về rồi bà con ơi",
        react: { "🎉": ["nv03", "nv05", "nv07", "nv10", "nv14", "nv01"], "😂": ["nv09"] },
        thread: [
          { by: "nv03", text: "Về cái là trả nợ trà sữa tháng 9 liền 😂", gap: 2 },
          { by: "nv07", text: "Tháng 9 tăng ca nhiều nên lương đẹp, chỉ có mắt là thâm 😵", react: { "😂": ["nv12", "nv03"] } }
        ]
      },
      { by: "admin", text: "Ai thắc mắc về phiếu lương thì nhắn riêng mình nhé, đừng post ở đây nha 😄", gap: 9, react: { "👍": ["nv12", "nv07", "nv03"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-06", time: "08:40",
    lines: [
      {
        by: "lead2", text: "🎉 Chúc mừng sinh nhật @{lead1}! Chúc trưởng ca A tuổi mới sức khoẻ, ca nào cũng xong đơn sớm, khách nào cũng khen 🎂",
        react: { "🎉": ["lead1", "nv01", "nv04", "nv07", "nv12", "khoa"], "❤️": ["linh", "boss"] },
        thread: [
          { by: "nv01", text: "Chúc mừng sinh nhật sếp ca A! Tuổi mới bớt nhắc deadline tụi em xíu nha 😂", gap: 3 },
          { by: "lead1", text: "Tuổi mới vẫn nhắc như cũ nhé 😂 cảm ơn em" },
          { by: "nv04", text: "Chúc mừng sinh nhật ạ 🎂 chiều nay ca A có bất ngờ đó" },
          { by: "nv07", text: "Suỵt 🤫", react: { "😂": ["nv04", "nv01"] } }
        ]
      },
      {
        by: "boss", gap: 8,
        text: "Chúc mừng sinh nhật @{lead1}! Cảm ơn em đã giữ ca A vững vàng suốt mùa cao điểm. Tuổi mới thêm nhiều thành công nhé 🎉",
        react: { "❤️": ["lead1", "lead2", "nv04"], "👏": ["linh"] }
      },
      { by: "lead1", text: "Em cảm ơn anh và mọi người nhiều ạ 🙏" },
      { by: "khoa", text: "Chúc mừng sinh nhật, tuổi mới hàng ra 0 lỗi nhé 😄" },
      {
        by: "nv04", text: "Bất ngờ của ca A đây 🎂", gap: 440,
        files: [{ name: "sinh-nhat-truong-ca-a.jpg", hint: "team surprising their shift leader with a cake and party hats" }],
        react: { "❤️": ["lead1", "boss", "linh", "nv01", "nv07"], "😂": ["nv12"] }
      },
      { by: "lead1", text: "Bất ngờ thật sự, cảm ơn ca A nhiều lắm! Mai ai cũng được về sớm 15 phút 😂", react: { "🎉": ["nv04", "nv01", "nv07", "nv12"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-07", time: "11:50",
    lines: [
      { by: "nv07", text: "Mọi người có ai thấy Mướp đâu không 😢 2 hôm nay không thấy lên ăn", react: { "😢": ["nv03", "an", "nv05", "nv12"] } },
      { by: "nv03", text: "Hôm qua em thấy nó ngồi ở bãi xe tầng hầm" },
      { by: "admin", text: "Để mình hỏi bảo vệ giúp nhé" },
      {
        by: "admin", text: "Tìm thấy Mướp rồi! Đang nằm trong thùng carton hàng mới của bên IT 😂", gap: 40,
        files: [{ name: "muop-trong-thung.jpg", hint: "orange cat inside an empty cardboard box in a storage room" }],
        react: { "😂": ["nv07", "minh", "nv03", "an", "nv12"], "❤️": ["nv07", "nv05"] }
      },
      { by: "minh", text: "Thùng đó là thùng màn hình mới, anh còn chưa kịp đập hộp 😑" },
      { by: "nv07", text: "Thôi tặng Mướp cái thùng đó luôn đi anh Minh 🥺" },
      { by: "minh", text: "Ok, thùng thuộc về Mướp 😅", react: { "❤️": ["nv07", "nv03"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-08", time: "17:00",
    lines: [
      {
        by: "lead2", text: "Thứ 5 lại đến ⚽ tối nay 19h nha, tuần này có mấy bạn mới vào thử việc muốn đá, ai quen thì rủ theo",
        react: { "👍": ["nv10", "nv06", "minh", "nv14"] },
        thread: [
          { by: "nv10", text: "Tuyển retoucher biết đá tiền đạo đi ạ 😂", gap: 3, react: { "😂": ["lead2", "nv06"] } },
          { by: "lead2", text: "Tiêu chí tuyển dụng mới: blend HDR giỏi, sút phạt cũng giỏi 😎" }
        ]
      },
      { by: "minh", text: "Đá xong 21h có trận đội tuyển, ai ra quán cà phê xem chung không", gap: 8 },
      { by: "nv06", text: "Em đi cả 2 kèo" },
      { by: "nv14", text: "Em ca chiều, xem livestream góc màn hình như cũ 🙈", react: { "😂": ["lead2", "nv10"] } },
      { by: "nv10", text: "Đội tuyển thắng 3–0, đội mình đá cũng thắng, hôm nay ngày đẹp nhất tuần 🎉", gap: 300, react: { "🎉": ["nv06", "minh", "lead2", "nv14"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-09", time: "11:20",
    lines: [
      {
        by: "khoa", text: "Thông báo nhẹ: còn 11 ngày nữa là tới một ngày rất quan trọng. Hội anh em nhớ check nhóm riêng nha 🤫",
        react: { "👀": ["linh", "an", "nv03", "acc2", "nv05"], "😂": ["minh"] },
        thread: [
          { by: "nv03", text: "Ngày gì vậy anh Khoa, nói rõ đi 👀", gap: 3 },
          { by: "khoa", text: "Bí mật quốc gia 😎" },
          { by: "acc2", text: "Năm ngoái hội anh em hứa mà quên đó nha, năm nay nhớ á 😏" },
          { by: "minh", text: "Năm nay có kế hoạch hẳn hoi rồi, yên tâm 😌" },
          { by: "linh", text: "Chị ghi lại lời hứa này rồi nha 📝", react: { "😂": ["khoa", "minh", "acc2"] } }
        ]
      },
      { by: "minh", text: "@{boss} anh nhớ duyệt quỹ cho hội anh em nha 😄", gap: 8, react: { "😂": ["khoa", "nv10"] } },
      { by: "boss", text: "Anh nhớ rồi, quỹ có sẵn, kế hoạch gửi anh xem trước nhé 😉", react: { "🎉": ["minh", "khoa", "lead2", "nv10"] } },
      { by: "nv05", text: "Ủa sao em ngửi thấy mùi bất ngờ 20/10 rõ ràng ghê 😆" },
      { by: "an", text: "Giả bộ không biết đi mọi người 🤐", react: { "😂": ["nv05", "nv03", "acc2"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-09", time: "17:40",
    lines: [
      { by: "nv09", text: "Cuối tuần này mọi người đi đâu chơi không? Em tính đi cà phê sách" },
      { by: "nv02", text: "Em về quê ăn đám cưới bạn thân 💒" },
      { by: "an", text: "Chủ nhật mình đi chụp ảnh đường phố, @{nv06} @{nv09} đi chung không? 📷", react: { "👀": ["nv06", "nv09"] } },
      { by: "nv06", text: "Dự báo cuối tuần mưa chiều đó, nhớ mang áo mưa. Cà phê sách là hợp nhất rồi 😌" },
      { by: "linh", text: "Cuối tuần nghỉ ngơi đầy đủ nha cả nhà, tuần sau nhiều việc website với khách mới đó", react: { "👍": ["nv09", "an", "nv02"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-10", time: "11:45",
    lines: [
      {
        by: "nv13", text: "Thứ 7 văn phòng vắng ghê, ca sản xuất ai ăn trưa chung không",
        thread: [
          { by: "nv08", text: "Em! Đặt cơm văn phòng đi", gap: 2 },
          { by: "nv15", text: "Em ăn bánh mì thôi, đang làm dở ảnh tách nền khách Nhật" },
          { by: "lead2", text: "Ca B order chung luôn nha, 5 phần cơm sườn" },
          { by: "nv13", text: "Chốt 8 phần cơm sườn + 1 bánh mì ✅", react: { "👍": ["nv08", "lead2", "nv15"] } }
        ]
      },
      { by: "nv07", text: "Cho Mướp 1 phần sườn nữa 😂 @{nv13}", gap: 14, react: { "😂": ["nv13", "nv08"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-10", time: "15:20",
    lines: [
      {
        by: "lead2", text: "@{boss} anh ơi, công ty ở tòa đối diện rủ đá giao hữu tối thứ 5 tuần sau, mình nhận kèo không anh? ⚽",
        react: { "🔥": ["nv10", "nv06", "minh"] },
        thread: [
          { by: "nv10", text: "Nhận đi sếp ơi, đội mình đang lên form 😤", gap: 3 },
          { by: "minh", text: "Bên đó có mấy người đá phong trào giỏi lắm, nhận thì phải tập thêm" }
        ]
      },
      { by: "nv14", gap: 12, text: "@{boss} nếu đá thì cho tụi em đặt áo đấu in logo công ty được không ạ 🙏", react: { "👀": ["lead2", "nv10"] } },
      { by: "an", text: "Áo đấu để em thiết kế cho, ý tưởng có sẵn rồi 😎", react: { "🔥": ["nv14", "lead2"] } }
    ]
  },
  {
    where: { channel: "tan-gau" }, date: "2026-10-10", time: "17:50",
    lines: [
      { by: "nv12", text: "Ca chiều ăn tối gì đây, trời bắt đầu mưa rồi 🌧️" },
      { by: "nv01", text: "Bún bò đi, mưa ăn bún bò là hợp", gap: 2 },
      { by: "nv12", text: "Ok 3 bún bò, em đặt nha", gap: 2 },
      {
        by: "an", text: "@{boss} anh xem giúp em mấy ảnh team building bản đẹp, chọn 1 tấm in khổ lớn treo sảnh nha ạ", gap: 4,
        files: [{ name: "de-xuat-anh-treo-sanh.jpg", hint: "contact sheet of six team building beach photos numbered 1 to 6" }],
        react: { "❤️": ["nv12", "nv01"] }
      },
      { by: "nv01", text: "Em vote tấm số 4, cả đoàn nhảy lên trên biển 😍", gap: 3 },
      { by: "nv12", text: "Số 4 +1", gap: 2, react: { "👍": ["an"] } }
    ]
  },

  // ═════════════════════════════════ #team-building-thang-9 ═════════════════════════════════
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-01", time: "10:00",
    lines: [
      {
        by: "admin",
        text: "## Team building tháng 9 – Vũng Tàu\n\nChào cả nhà 👋 Kênh này dùng để tổ chức chuyến đi team building:\n- **Thời gian:** thứ 7 – chủ nhật, 26–27/9\n- **Địa điểm:** Vũng Tàu, ở lại 1 đêm\n- **Ban tổ chức:** mình, chị @{linh}, @{an}, @{nv02}, @{nv09}\n\nĐăng ký, xe, phòng, áo, trò chơi sẽ cập nhật hết ở đây. Ai có ý kiến cứ góp nhé!",
        react: { "🎉": ["linh", "an", "nv02", "nv09", "boss"], "❤️": ["nv05"] },
        thread: [
          { by: "nv05", text: "Ca trực sản xuất 2 ngày đó tính sao ạ?", gap: 6 },
          { by: "linh", text: "Chia 2 nhóm trực luân phiên, ai trực đợt này được bù 1 ngày phép + quà nhé" },
          { by: "nv05", text: "Dạ vậy ổn quá ạ 😄" }
        ]
      },
      {
        by: "boss", gap: 9,
        text: "Anh duyệt chủ trương rồi. Các em lên kế hoạch chi tiết và dự toán gửi anh trong tuần sau nhé. Đi chơi là chính, an toàn là trên hết 👍",
        react: { "👍": ["admin", "linh", "an", "nv02", "nv09"] }
      },
      { by: "nv02", text: "Dạ em với @{nv09} lo phần trò chơi với gala nha" },
      { by: "nv09", text: "Dạ em có mấy ý tưởng rồi, lát em gom lại ạ 😆" }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-03", time: "14:30",
    lines: [
      {
        by: "admin",
        text: "📝 Mở đăng ký tham gia: [form đăng ký](https://nesso.example/forms/team-building-t9). Hạn chót **thứ 4, 9/9**. Có thể đi kèm 1 người thân, phần phát sinh tự túc nhé.",
        react: { "👍": ["linh", "nv02"] }
      },
      { by: "nv11", text: "Em đăng ký rồi ạ. Cho em hỏi ngày 27 về sớm được không?" },
      { by: "admin", text: "Được nhé, ghi chú vào form, nếu đủ người mình sắp xe về riêng" },
      { by: "acc2", text: "Mình đăng ký kèm 1 bé nhà mình nha 😄" },
      { by: "nv05", text: "Em đăng ký rồi, hóng quá 🏖️" },
      { by: "nv09", text: "Hiện đã có 28 bạn đăng ký rồi nè 🎉", gap: 40, react: { "🎉": ["admin", "an", "nv02"] } },
      { by: "khoa", text: "Anh đăng ký rồi, nhưng QC chủ nhật ai trực?" },
      { by: "linh", text: "@{khoa} QC trực chủ nhật để chị sắp lịch luân phiên cùng ca sản xuất nhé" }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-08", time: "15:00",
    lines: [
      {
        by: "nv09",
        text: "Cập nhật xe: em đã hỏi 2 nhà xe, đều có xe 45 chỗ. Danh sách đăng ký hiện 41 người nên đặt 1 xe 45 + 1 xe 16 chỗ cho thoải mái ạ",
        react: { "👍": ["admin", "linh"] }
      },
      { by: "admin", text: "Ok em, chọn nhà xe có bảo hiểm hành khách đầy đủ và tài xế quen tuyến nhé" },
      { by: "nv09", text: "Dạ nhà xe thứ 2 xe đời mới, bảo hiểm đủ, em gửi báo giá vào nhóm ban tổ chức ạ" },
      { by: "linh", text: "Xuất phát 6h sáng thứ 7 trước cổng công ty nhé, đi sớm tránh kẹt xe" },
      { by: "nv02", text: "6h hơi sớm với ca đêm thứ 6 đó chị 😅" },
      { by: "linh", text: "Ca đêm thứ 6 chị cho nghỉ, ai trực thì đi xe 16 chỗ lúc 10h nhé", react: { "❤️": ["nv02", "nv09"] } }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-10", time: "10:30",
    lines: [
      {
        by: "admin", text: "@{boss} em gửi anh dự toán chuyến đi (xe, khách sạn, ăn uống, gala, áo, quà trò chơi) ạ",
        files: [{ name: "du-toan-team-building-t9.xlsx", hint: "trip budget breakdown by category: transport, hotel, meals, gala, shirts, prizes" }]
      },
      {
        by: "boss", gap: 25,
        text: "Anh xem rồi, duyệt nhé. Phần ăn uống cho thoải mái, đừng cắt. Thêm khoản dự phòng y tế và bảo hiểm du lịch cho cả đoàn",
        react: { "🙏": ["admin", "linh"], "🎉": ["nv02", "nv09"] }
      },
      { by: "admin", text: "Dạ em bổ sung bảo hiểm du lịch với túi y tế ngay ạ" },
      { by: "linh", text: "Cảm ơn anh. Em chốt lịch trình gửi cả nhà trước chuyến đi nhé" },
      { by: "an", text: "Yay duyệt rồi 🎉 em bắt đầu vẽ áo đây", react: { "🔥": ["nv02"] } }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-15", time: "16:00",
    lines: [
      {
        by: "admin", text: "🏨 Đã chốt khách sạn gần bãi biển, phòng 4 người. Danh sách chia phòng dự kiến đây, ai muốn đổi thì báo trước thứ 6 nhé",
        files: [{ name: "danh-sach-chia-phong.xlsx", hint: "room allocation list, four people per room, grouped by team" }],
        react: { "👀": ["nv05", "nv11", "acc2"] }
      },
      { by: "nv11", text: "Cho em đổi qua phòng có @{nv05} được không ạ 🙏" },
      { by: "admin", text: "Ok, mình đổi rồi nhé" },
      { by: "acc2", text: "Phòng mình có bé nhà mình, xin phòng tầng thấp với ạ" },
      { by: "admin", text: "Đã xếp tầng 2 rồi nhé" },
      { by: "nv05", text: "Phòng có view biển không ạ 😍" },
      { by: "admin", text: "Một nửa view biển, một nửa view… hồ bơi 😂 bốc thăm cho công bằng", react: { "😂": ["nv05", "nv11", "an"] } }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-17", time: "11:00",
    lines: [
      {
        by: "an", text: "👕 Mẫu áo đồng phục đây cả nhà! 2 phương án màu, vote trong thread nhé",
        files: [{ name: "mockup-ao-dong-phuc.png", hint: "two t-shirt mockups side by side, teal and coral, small camera-aperture logo and slogan" }],
        react: { "❤️": ["linh", "nv02", "nv09", "boss"], "🔥": ["nv05"] },
        thread: [
          { by: "nv02", text: "Em vote xanh ngọc, lên ảnh biển đẹp", gap: 4 },
          { by: "nv05", text: "Cam san hô nổi hơn á, chụp xa vẫn thấy" },
          { by: "linh", text: "Chị vote xanh ngọc" },
          { by: "boss", text: "Anh vote xanh ngọc, slogan cho to thêm chút" },
          { by: "nv09", text: "Chốt xanh ngọc: 9 phiếu – 4 phiếu nha 🎉", gap: 90 },
          { by: "an", text: "Ok em sửa slogan to hơn rồi gửi in ✅", react: { "👍": ["boss", "linh"] } }
        ]
      },
      {
        by: "an", gap: 8,
        text: "Mọi người điền size áo vào cột cuối file đăng ký giúp mình nhé, hạn trưa thứ 2",
        edited: "Mọi người điền size áo vào cột cuối file đăng ký giúp mình nhé, hạn **12h thứ 2 (21/9)**"
      }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-22", time: "14:00",
    lines: [
      {
        by: "nv02",
        text: "🎮 Kịch bản trò chơi dự kiến:\n1. Chiều thứ 7: kéo co, đua thuyền trên cát, truy tìm kho báu\n2. Tối thứ 7: gala dinner, văn nghệ từng ca, bốc thăm quà\n3. Sáng chủ nhật: tự do tắm biển, 10h trả phòng\n\nMỗi ca sản xuất là 1 đội, khối văn phòng ghép thành 1 đội nhé!",
        react: { "🔥": ["nv09", "an", "linh"], "👍": ["admin"] }
      },
      { by: "khoa", text: "QC đi chung đội văn phòng hả, vậy tụi anh chịu thiệt rồi 😂" },
      { by: "nv09", text: "Đội văn phòng có sếp nên cân bằng lực lượng á anh 😆", react: { "😂": ["khoa", "nv02"] } },
      { by: "linh", text: "Văn nghệ mỗi đội 1 tiết mục tối đa 5 phút nhé" },
      { by: "nv02", text: "@{boss} gala anh phát biểu mở màn giúp tụi em nha 🙏" },
      { by: "boss", text: "Ok, anh nói ngắn thôi rồi nhường sân khấu cho anh em", gap: 15, react: { "🎉": ["nv02", "nv09"] } }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-24", time: "16:30",
    lines: [
      {
        by: "linh",
        text: "## Lịch trình chốt\n- **05:45** tập trung trước cổng công ty, nhận áo\n- **06:00** xuất phát\n- **09:30** nhận phòng, gửi đồ, ăn nhẹ\n- **15:30** trò chơi bãi biển\n- **18:30** gala dinner\n- **CN 10:00** trả phòng, **14:00** về tới công ty\n\nNhớ mang giấy tờ tùy thân, kem chống nắng, đồ bơi nhé!",
        react: { "👍": ["admin", "nv02", "nv09", "nv05", "nv11"], "❤️": ["an"] }
      },
      { by: "nv11", text: "Áo phát lúc tập trung luôn hả chị?" },
      { by: "admin", text: "Đúng rồi, áo xếp theo size có dán tên, nhận lúc 5h45 nhé" },
      { by: "nv05", text: "Em đặt báo thức 4h30 luôn rồi 😂", react: { "😂": ["nv11", "nv09"] } }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-26", time: "05:45",
    lines: [
      { by: "admin", text: "Xe đã tới cổng công ty, mọi người tới thì điểm danh với @{nv09} nhé 🚌", react: { "👍": ["nv09", "nv02"] } },
      { by: "nv09", text: "Đã đủ 39/41, còn 2 bạn đang tới 🏃", gap: 8 },
      { by: "nv11", text: "Em tới rồi, xin lỗi kẹt đèn đỏ 😅" },
      {
        by: "nv09", text: "Đủ 41/41, xuất phát thôi! 🎉",
        files: [{ name: "xuat-phat-som.jpg", hint: "group in matching teal t-shirts boarding a coach bus at dawn" }],
        react: { "🎉": ["admin", "linh", "an", "nv02", "boss", "nv05"] }
      },
      { by: "boss", text: "Chúc cả đoàn đi vui vẻ, an toàn. Hẹn mọi người ở khách sạn nhé 👍", react: { "❤️": ["linh", "nv09"] } }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-27", time: "14:10",
    lines: [
      {
        by: "linh", text: "Xe đã về tới công ty an toàn 🙌 Cảm ơn cả nhà đã tham gia nhiệt tình, cảm ơn ban tổ chức đã chạy suốt 2 ngày!",
        react: { "❤️": ["admin", "an", "nv02", "nv09", "nv05", "boss"] }
      },
      {
        by: "boss", text: "Cảm ơn ban tổ chức nhé. Chuyến đi rất vui và gọn gàng. Thứ 2 gặp lại mọi người với năng lượng mới 💪",
        react: { "🙏": ["admin", "nv02", "nv09"], "❤️": ["linh", "an"] }
      },
      { by: "nv02", text: "Mệt mà vui quá trời, cảm ơn mọi người đã chơi hết mình 🥹" },
      { by: "nv05", text: "Cho em xin ảnh đội đua thuyền với ạ 🙏" },
      { by: "an", text: "Mai mình up album đầy đủ nha, đang lọc ảnh 😆", react: { "👍": ["nv05"] } }
    ]
  },
  {
    where: { channel: "team-building-thang-9" }, date: "2026-09-28", time: "08:40",
    lines: [
      {
        by: "an", text: "📸 Album đầy đủ đã up: [album team building](https://nesso.example/albums/team-building-vung-tau). Vài tấm nổi bật nè:",
        files: [
          { name: "tb-keo-co.jpg", hint: "tug of war on the beach, teams in teal shirts" },
          { name: "tb-gala.jpg", hint: "gala dinner stage with performers and colored lights" }
        ],
        react: { "❤️": ["nv02", "nv09", "linh", "admin", "nv05", "nv11"] }
      },
      {
        by: "admin",
        text: "Cảm ơn mọi người đã đồng hành 🙏 Hoá đơn và quyết toán mình tổng hợp gửi ban điều hành trong tuần. Kênh này sẽ được lưu trữ trong hôm nay, ai cần ảnh thì lưu lại nhé.",
        react: { "👍": ["linh", "an", "nv02", "nv09"] }
      },
      { by: "nv09", text: "Hẹn team building năm sau nha cả nhà 🥳" },
      { by: "linh", text: "Cảm ơn ban tổ chức một lần nữa, 10 điểm không có nhưng 👏", react: { "😂": ["nv02", "nv09"] } }
    ]
  },

  // ═════════════════════════════════════ #ban-dieu-hanh ═════════════════════════════════════
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-08-25", time: "08:30",
    lines: [
      {
        by: "boss",
        text: "Chào ban điều hành. Từ hôm nay mình dùng kênh riêng này thay cho group Zalo cũ. Quy ước:\n- **Sáng thứ 2:** mỗi người cập nhật số liệu tuần trước (sản lượng, đơn khách, nhân sự, chi phí)\n- Việc cần anh quyết thì @ anh trực tiếp\n- Thông tin ở đây là **nội bộ**, không chia sẻ ra ngoài",
        react: { "👍": ["linh", "admin", "acc1", "lead1"] }
      },
      { by: "linh", text: "Dạ em đã chuyển các file theo dõi chung sang dự án Vận hành trên Nesso Work rồi ạ" },
      { by: "admin", text: "Em đã phân quyền xong, kênh này chỉ có 5 người thôi anh" },
      { by: "lead1", text: "Dạ em nắm ạ. Báo cáo sản xuất em gửi theo mẫu cũ, sáng thứ 2 trước 9h" },
      { by: "acc1", text: "Em gửi tình hình đơn khách và phản hồi cùng lúc ạ" },
      { by: "boss", text: "Tốt. Bắt đầu từ thứ 2 tuần sau nhé 👍" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-08-31", time: "08:15",
    lines: [
      {
        by: "lead1",
        text: "**Sản xuất tuần 35:**\n- Sản lượng đạt 97% kế hoạch, ca A 101%, ca B 93%\n- Tỷ lệ trả sửa nội bộ 4,2%\n- 2 bạn nghỉ phép, 1 bạn nghỉ ốm",
        react: { "👀": ["boss"] },
        thread: [
          { by: "boss", text: "Ca B vì sao thấp em?", gap: 12 },
          { by: "lead1", text: "Dạ ca B có 2 bạn mới đang kèm, tốc độ chưa lên, với tuần rồi nhiều đơn day-to-dusk nặng ạ" },
          { by: "boss", text: "Ok, theo dõi 2 bạn mới thêm 2 tuần, cần thì cho học lại quy trình với anh Khoa" },
          { by: "lead1", text: "Dạ em lên lịch kèm luôn ạ" }
        ]
      },
      {
        by: "acc1", gap: 6,
        text: "**Đơn khách tuần 35:** số đơn tăng 8% so với tuần trước, khách BĐS bên Úc chiếm khoảng 60%. Có 1 phản hồi về màu trời, đã xử lý xong trong ngày.",
        react: { "👍": ["boss", "linh"] }
      },
      { by: "linh", text: "Em lưu ý: giữa tháng 9 vào mùa xuân bên Úc, năm ngoái đơn tăng gần gấp rưỡi. Em đề xuất chuẩn bị phương án tăng ca từ tuần 38" },
      {
        by: "boss", text: "Đồng ý. @{lead1} lên phương án ca đêm, @{admin} kiểm tra chế độ tăng ca cho đúng luật nhé",
        react: { "✅": ["lead1", "admin"] }
      }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-03", time: "15:00",
    lines: [
      { by: "admin", text: "Anh ơi, về tuyển retoucher: hiện có 14 hồ sơ, em lọc được 6 bạn làm bài test. Em đề xuất tuyển thêm 2 bạn trong tháng 9 để kịp mùa cao điểm" },
      { by: "boss", text: "Bài test cho làm thực tế 1 bộ HDR và 1 ảnh xoá vật thể. @{lead1} chấm cùng anh Khoa nhé", gap: 10 },
      { by: "lead1", text: "Dạ em chấm được, gửi em bài test trước thứ 3 ạ" },
      { by: "linh", text: "Lưu ý các bạn mới phải ký cam kết bảo mật trước khi tiếp cận dữ liệu khách nhé", react: { "👍": ["admin", "boss"] } },
      { by: "admin", text: "Dạ đúng rồi chị, em đã cập nhật mẫu cam kết mới" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-07", time: "08:10",
    lines: [
      {
        by: "lead1", text: "**Sản xuất tuần 36** (có 2 ngày lễ): đạt 92% kế hoạch, ca trực lễ hoàn thành 100% đơn gấp. Trả sửa nội bộ 3,8%.",
        react: { "👏": ["boss", "linh"] }
      },
      {
        by: "acc1",
        text: "**Khách:** có 1 agency lớn bên Úc liên hệ, muốn thử 50 ảnh HDR tuần này. Nếu đạt thì họ chuyển khoảng 30% lượng đơn sang mình từ mùa xuân",
        react: { "🔥": ["boss", "linh"], "👀": ["lead1"] },
        thread: [
          { by: "boss", text: "Khách này ưu tiên. Bộ trial giao trước hạn, cho QC duyệt 2 lần", gap: 5 },
          { by: "acc1", text: "Dạ em đã báo anh Khoa, giao trial thứ 4 ạ" },
          { by: "linh", text: "Em xếp người tay nghề tốt nhất ca A làm bộ này" },
          { by: "boss", text: "Ok, có kết quả báo anh ngay nhé" }
        ]
      },
      { by: "boss", text: "Tuần này tập trung chuẩn bị cho đợt cao điểm. @{linh} chốt kế hoạch nhân sự tăng ca trước thứ 6 nhé", gap: 8 },
      { by: "linh", text: "Dạ em gửi anh trước thứ 5 ạ" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-09", time: "16:00",
    lines: [
      {
        by: "linh",
        text: "Em gửi bản nháp chính sách thưởng KPI quý 4: tính theo sản lượng đạt chuẩn, tỷ lệ trả sửa và tỷ lệ đúng hạn. Mọi người góp ý giúp em",
        files: [{ name: "chinh-sach-thuong-kpi-q4-nhap.docx", hint: "draft KPI bonus policy with weighting table: output, rework rate, on-time delivery" }],
        react: { "👀": ["boss", "admin", "lead1"] },
        thread: [
          { by: "lead1", text: "Tỷ lệ trả sửa nên tách lỗi khách báo với lỗi QC nội bộ bắt được chị, để các bạn không ngại gửi QC", gap: 20 },
          { by: "linh", text: "Ý hay, chị chia 2 mức trọng số" },
          { by: "admin", text: "Cần chốt trước 25/9 để kịp đưa vào bảng lương tháng 10 ạ" },
          { by: "boss", text: "Anh đồng ý hướng này. Thêm tiêu chí đào tạo người mới cho trưởng ca. Bản cuối gửi anh duyệt" },
          { by: "linh", text: "Dạ em sửa xong gửi anh thứ 2 tuần sau ạ" }
        ]
      },
      { by: "acc1", text: "Bên account có KPI riêng không chị? Ví dụ thời gian phản hồi khách", gap: 30 },
      { by: "linh", text: "Có nhé, chị làm bảng riêng cho account, em góp ý giúp chị chỉ số phản hồi" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-14", time: "08:05",
    lines: [
      { by: "lead1", text: "**Sản xuất tuần 37:** đạt 103% kế hoạch. Từ tối nay bắt đầu ca đêm 22h–6h, 5 bạn luân phiên", react: { "👍": ["boss"] } },
      {
        by: "acc1", text: "**Khách:** agency Úc mới đã duyệt trial, tuần này gửi đợt đầu. Tổng đơn tuần này dự kiến tăng 45% so với tuần trước",
        react: { "🎉": ["boss", "linh", "lead1"] }
      },
      {
        by: "boss",
        text: "Tốt lắm. Tuần này ưu tiên đúng hạn và chất lượng, chưa chắc năng lực thì đừng nhận thêm khách mới. @{acc1} khách nào dí deadline bất hợp lý thì báo anh"
      },
      { by: "acc1", text: "Dạ em nắm ạ" },
      { by: "admin", text: "Em đã chuẩn bị đồ ăn khuya và đặt xe đưa ca đêm về ạ", react: { "🙏": ["lead1", "boss"] } },
      { by: "boss", text: "Cảm ơn em. Ca đêm về muộn nhớ đảm bảo an toàn cho các bạn" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-16", time: "20:40",
    lines: [
      {
        by: "lead1", text: "Báo cáo nhanh anh: tới 20h đã giao 86% đơn hôm nay, còn 2 job HDR lớn, ca đêm nhận tiếp. Dự kiến xong trước 5h sáng giờ Úc",
        react: { "👍": ["boss", "linh"] }
      },
      { by: "boss", text: "Anh em vất vả. Cần thêm người thì cho ca A làm thêm 2h, anh duyệt tăng ca" },
      { by: "linh", text: "Em trực online tới 23h, có gì em hỗ trợ điều phối" },
      { by: "acc1", text: "Khách Úc vừa nhắn khen bộ ảnh hôm qua, em chuyển lời cho ca B ạ", react: { "❤️": ["boss", "lead1", "linh"] } },
      { by: "boss", text: "Tuyệt. Chuyển lời anh cảm ơn ca B nhé 👏" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-18", time: "14:00",
    lines: [
      {
        by: "admin",
        text: "Trước khi chuyển NAS cuối tuần này, em rà soát rủi ro bảo mật dữ liệu khách:\n- Vài máy còn cắm USB tự do\n- Thư mục chia sẻ cũ đang để quyền 'Everyone'\n- Ảnh khách lưu trên máy cá nhân quá 30 ngày chưa xoá\n\nEm đề xuất khoá cổng USB, phân quyền lại theo nhóm và quy định xoá dữ liệu 30 ngày sau khi giao.",
        react: { "👀": ["boss", "linh"], "👍": ["lead1"] },
        thread: [
          { by: "boss", text: "Đồng ý cả 3. Khoá USB làm ngay sau khi chuyển NAS, ai cần thì xin ngoại lệ có thời hạn", gap: 15 },
          { by: "lead1", text: "Nhiều bạn quen chép file qua USB, em sẽ phổ biến lại trước" },
          { by: "acc1", text: "Có 2 khách đã yêu cầu ký thêm điều khoản bảo mật, em đề xuất mình chủ động gửi cho tất cả khách lớn ạ" },
          { by: "boss", text: "Ok, @{acc1} soạn mẫu chung, @{admin} rà lại phần pháp lý" },
          { by: "admin", text: "Dạ em phối hợp với anh Minh làm phần kỹ thuật luôn ạ" }
        ]
      },
      { by: "linh", text: "Em sẽ đưa nội dung này vào buổi đào tạo nhân viên mới ạ", gap: 25 }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-21", time: "08:10",
    lines: [
      {
        by: "lead1",
        text: "**Sản xuất tuần 38 (cao điểm):** sản lượng tăng 38% so với tuần 37, đạt 112% kế hoạch. Đúng hạn 98,5%. Có 3 phản hồi về màu trời và kéo cửa sổ, đã sửa lại hết",
        edited: "**Sản xuất tuần 38 (cao điểm):** sản lượng tăng 38% so với tuần 37, đạt 112% kế hoạch. Đúng hạn 98,2%. Có 3 phản hồi về màu trời và kéo cửa sổ, đã sửa lại hết",
        react: { "🔥": ["boss", "linh"], "👏": ["acc1"] }
      },
      { by: "acc1", text: "Khách Úc mới gửi tiếp đơn tuần này, đã chiếm khoảng 20% tổng đơn. Họ muốn làm hợp đồng theo quý" },
      {
        by: "boss", text: "Rất tốt, cảm ơn mọi người tuần vừa rồi. @{linh} tổng hợp danh sách các bạn tăng ca nhiều để anh thưởng nóng nhé",
        react: { "❤️": ["lead1", "linh", "admin"] }
      },
      { by: "admin", text: "NAS mới sáng nay còn lỗi phân quyền vài thư mục, anh Minh đang xử lý, dự kiến xong trước trưa ạ" },
      { by: "linh", text: "Em gửi danh sách thưởng nóng trước thứ 4 ạ" },
      { by: "boss", text: "Ok. Hợp đồng quý với khách Úc: @{acc1} soạn đề xuất, chiều mai mình họp" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-24", time: "10:30",
    lines: [
      {
        by: "admin",
        text: "Anh ơi, em đã đi xem mặt bằng tầng 3 tòa bên cạnh: diện tích khoảng 1,5 lần tầng 2 hiện tại, điện 3 pha, có thể vào từ tháng 11. Ảnh và sơ đồ em gửi kèm",
        files: [
          { name: "so-do-mat-bang-tang-3.pdf", hint: "floor plan of an empty office floor with dimensions" },
          { name: "mat-bang-tang-3.jpg", hint: "empty open-plan office floor with large windows" }
        ],
        react: { "👀": ["boss", "linh"] },
        thread: [
          { by: "boss", text: "Tầng này đủ chỗ khoảng bao nhiêu máy?", gap: 18 },
          { by: "admin", text: "Dạ khoảng 35–40 máy nếu bố trí như hiện tại ạ" },
          { by: "lead1", text: "Nếu tách ca đêm qua bên này thì ca ngày đỡ ồn hẳn anh ạ" },
          { by: "boss", text: "Chưa quyết vội. Anh muốn xem sản lượng Q4 và kế hoạch tuyển dụng trước. @{admin} xin họ giữ chỗ tới giữa tháng 10 được không?" },
          { by: "admin", text: "Dạ em hỏi liền ạ" }
        ]
      },
      { by: "linh", text: "Em sẽ đưa phương án mặt bằng vào kế hoạch ngân sách 2027 luôn nhé anh", gap: 30 },
      { by: "boss", text: "Đúng, đưa vào kịch bản tăng trưởng" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-28", time: "08:05",
    lines: [
      { by: "lead1", text: "**Sản xuất tuần 39:** đạt 101% kế hoạch dù có 2 ngày team building, ca trực làm rất tốt", react: { "👏": ["boss", "linh", "admin"] } },
      {
        by: "acc1", text: "Đơn tuần 39 về mức bình thường, giảm 15% so với tuần cao điểm. Khách Úc mới đã đồng ý hợp đồng theo quý 🎉",
        react: { "🎉": ["boss", "linh", "lead1", "admin"] }
      },
      {
        by: "boss",
        text: "Tin rất vui. Từ tuần này mình bắt đầu làm **ngân sách 2027**. Mỗi người phụ trách phần của mình theo file mẫu, hạn bản nháp 10/10",
        files: [{ name: "mau-ngan-sach-2027.xlsx", hint: "budget template with tabs: revenue scenarios, headcount, rent, equipment, training" }],
        react: { "👍": ["linh", "admin", "acc1", "lead1"] },
        thread: [
          { by: "linh", text: "Em phụ trách tổng hợp và phần vận hành ạ", gap: 4 },
          { by: "admin", text: "Em làm nhân sự, mặt bằng, hành chính" },
          { by: "acc1", text: "Em làm dự báo doanh thu theo nhóm khách, 3 kịch bản" },
          { by: "lead1", text: "Em làm phần thiết bị và đào tạo sản xuất ạ" },
          { by: "boss", text: "Tốt. Kịch bản tăng trưởng tính cả phương án thuê thêm tầng 3" }
        ]
      },
      { by: "admin", text: "Dạ, quyết toán team building em gửi chị Linh trong tuần ạ", gap: 15 }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-09-30", time: "17:30",
    lines: [
      {
        by: "linh",
        text: "Em gửi anh báo cáo kết quả **quý 3**. Tóm tắt:\n- Sản lượng tăng 22% so với quý 2\n- Đúng hạn 97,8%\n- Tỷ lệ khiếu nại giảm từ 1,9% xuống 1,4%\n- Thêm 3 khách mới, trong đó 1 khách hợp đồng theo quý\n- Nhân sự: nghỉ việc 1 retoucher, kết thúc 1 thực tập sinh",
        files: [
          { name: "bao-cao-quy-3-2026.pdf", hint: "quarterly report cover page and KPI summary charts" },
          { name: "so-lieu-quy-3-2026.xlsx", hint: "quarterly production and customer data by month" }
        ],
        react: { "👏": ["boss", "admin", "acc1", "lead1"], "🎉": ["acc1"] }
      },
      {
        by: "boss", gap: 20,
        text: "Cảm ơn em. Quý 3 rất tốt. Sáng thứ 6 họp ban điều hành 1 tiếng để rút kinh nghiệm và chốt mục tiêu Q4",
        react: { "👍": ["linh", "admin", "lead1"] }
      },
      { by: "lead1", text: "Dạ em chuẩn bị phần tổng kết sản xuất ạ" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-01", time: "09:15",
    lines: [
      {
        by: "boss",
        text: "Anh đọc kỹ báo cáo quý 3 rồi. 3 điểm anh muốn bàn sáng mai:\n1. Khiếu nại vẫn tập trung ở màu trời và kéo cửa sổ → cần cập nhật QC checklist\n2. Phụ thuộc khách Úc quá nhiều, cần đa dạng thị trường\n3. Tốc độ đào tạo người mới còn chậm",
        react: { "👀": ["linh", "lead1", "acc1"] },
        thread: [
          { by: "linh", text: "Dạ checklist QC v2 anh Khoa đã soạn xong, dự kiến áp dụng từ 5/10", gap: 7 },
          { by: "acc1", text: "Về thị trường, có 1 khách Nhật cần tách nền sản phẩm đang hỏi làm thử, em báo cáo chi tiết sáng mai ạ" },
          { by: "lead1", text: "Đào tạo em đề xuất 2 tuần kèm 1-1 rồi mới giao đơn thật" },
          { by: "boss", text: "Ok, mai chốt từng mục" }
        ]
      },
      { by: "admin", text: "Em đặt phòng họp nhỏ 9h–10h sáng mai rồi ạ", gap: 12, react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-02", time: "15:30",
    lines: [
      {
        by: "admin",
        text: "@{boss} bảng lương tháng 9 đã xong, gồm tăng ca đợt cao điểm và thưởng nóng theo danh sách chị Linh gửi. Em gửi anh duyệt để chi đúng ngày 5/10 ạ",
        files: [{ name: "bang-luong-thang-9-tong-hop.xlsx", hint: "payroll summary by department with overtime and bonus columns, names hidden" }],
        react: { "👀": ["boss"] }
      },
      { by: "boss", text: "Anh duyệt. Lưu ý gửi phiếu lương riêng từng người, không chuyển file tổng ra chỗ khác", gap: 35, react: { "✅": ["admin"] } },
      { by: "admin", text: "Dạ em gửi phiếu lương riêng cho từng bạn như mọi tháng ạ" },
      { by: "linh", text: "Tháng này tăng ca nhiều, em đề nghị kèm vài dòng cảm ơn của anh trong phiếu lương" },
      { by: "boss", text: "Ý hay, em soạn giúp anh nhé", react: { "👍": ["linh"] } }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-05", time: "08:10",
    lines: [
      {
        by: "boss",
        text: "## Mục tiêu Q4\n- Sản lượng tăng 15% so với Q3\n- Tỷ lệ khiếu nại dưới 1%\n- Tuyển và đào tạo xong **6 retoucher** trước 15/11\n- Ra mắt website mới ngày 15/10\n- Ít nhất 1 khách ngoài thị trường Úc ký hợp đồng\n- Chốt ngân sách 2027 trước 31/10\n\nMọi người chuyển thành công việc trong dự án nhé.",
        react: { "👍": ["linh", "admin", "acc1", "lead1"], "🔥": ["lead1"] },
        thread: [
          { by: "admin", text: "Tuyển 6 bạn: em đã đăng tin, tuần này phỏng vấn đợt 1", gap: 6 },
          { by: "lead1", text: "Em chuẩn bị 2 người kèm cặp ở mỗi ca" },
          { by: "acc1", text: "Khách Nhật đã đồng ý trial 100 ảnh tách nền sản phẩm, gửi file thứ 4 này ạ" },
          { by: "boss", text: "Tốt. Trial khách Nhật làm cực kỹ, họ rất khó về đường viền" }
        ]
      },
      { by: "lead1", text: "**Sản xuất tuần 40:** đạt 99% kế hoạch, trả sửa nội bộ 3,1% – thấp nhất từ đầu năm", gap: 10, react: { "👏": ["boss", "linh"] } },
      { by: "linh", text: "Lương tháng 9 đã chi đúng hạn sáng nay ạ", react: { "👍": ["boss", "admin"] } }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-06", time: "14:00",
    lines: [
      {
        by: "acc1",
        text: "Khách Nhật gửi hướng dẫn kỹ thuật 18 trang cho trial: viền phải đi bằng pen tool, sai số dưới 1px, giữ bóng đổ tự nhiên. Em đề xuất chỉ để 3 bạn giỏi nhất làm",
        files: [{ name: "tom-tat-yeu-cau-khach-nhat.pdf", hint: "summary of strict clipping path requirements with zoomed edge examples" }],
        react: { "😮": ["lead1"], "👀": ["boss"] }
      },
      { by: "lead1", text: "Dạ em chọn 3 bạn ca A, cho làm thử 10 ảnh trước, QC 100%" },
      { by: "boss", text: "Đồng ý. Đừng vội, đúng hơn nhanh. Đây là cửa vào thị trường Nhật", react: { "💯": ["acc1", "lead1", "linh"] } },
      { by: "linh", text: "Em xếp lịch QC riêng cho trial, anh Khoa duyệt trực tiếp" },
      { by: "acc1", text: "Hạn trial là thứ 3 tuần sau, mình còn đủ thời gian ạ" }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-07", time: "16:30",
    lines: [
      {
        by: "linh",
        text: "Bản nháp ngân sách 2027 v1 đã gom đủ 4 phần. Có 3 kịch bản: giữ nguyên, tăng trưởng vừa, tăng trưởng mạnh (thuê thêm tầng 3)",
        files: [{ name: "ngan-sach-2027-v1.xlsx", hint: "budget draft comparing three growth scenarios" }],
        react: { "👀": ["boss", "admin", "acc1"] },
        thread: [
          { by: "boss", text: "Kịch bản tăng trưởng mạnh giả định doanh thu dựa trên khách nào?", gap: 40 },
          { by: "acc1", text: "Dạ dựa trên khách Úc hợp đồng quý và khách Nhật nếu trial đạt, có phần dự phòng nếu khách Nhật không ký" },
          { by: "boss", text: "Thêm kịch bản xấu: mất 1 khách lớn. Anh cần biết điểm hoà vốn khi thuê thêm mặt bằng" },
          { by: "linh", text: "Dạ em bổ sung trong v2, gửi anh trước thứ 7" }
        ]
      },
      { by: "admin", text: "Bên tòa nhà đồng ý giữ tầng 3 tới 20/10 anh ạ", gap: 50, react: { "👍": ["boss"] } }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-09", time: "15:40",
    lines: [
      { by: "admin", text: "Cập nhật tuyển dụng: phỏng vấn đợt 1 xong 9 bạn, 4 bạn qua bài test. Thứ 2 tuần sau 3 bạn vào thử việc", react: { "👏": ["boss", "lead1"] } },
      { by: "lead1", text: "Em đã chuẩn bị máy và tài khoản cho 3 bạn, tuần đầu đào tạo ở ca A" },
      { by: "boss", text: "Tốt. Các bạn mới ký cam kết bảo mật trước, và chưa được dùng USB nhé", react: { "✅": ["admin", "lead1"] } },
      { by: "acc1", text: "Trial khách Nhật: 10 ảnh đầu QC đạt 9/10, 1 ảnh sửa lại viền tóc. Đang làm tiếp 90 ảnh", react: { "🔥": ["boss", "linh", "lead1"] } },
      { by: "linh", text: "Tuần sau mình cần chốt chương trình 20/10 cho chị em, @{admin} có phương án chưa?" },
      {
        by: "admin", text: "Dạ có rồi chị: tặng hoa và quà, trưa 20/10 tiệc buffet, hội anh em có tiết mục riêng. Em gửi chi tiết để anh duyệt ạ",
        react: { "👍": ["linh"] }
      }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-10", time: "09:30",
    lines: [
      {
        by: "lead1",
        text: "**Sản xuất tuần 41 (sơ bộ tới sáng nay):** đạt 96% kế hoạch. QC checklist v2 làm trả sửa nội bộ tăng lên 4% trong mấy ngày đầu, các bạn đang quen dần",
        react: { "👀": ["boss", "linh"] },
        thread: [
          { by: "boss", text: "Trả sửa tăng do checklist khắt khe hơn là bình thường. Theo dõi thêm 1 tuần", gap: 15 },
          { by: "linh", text: "Em sẽ cùng anh Khoa xem lại 2 mục bị trả nhiều nhất" },
          { by: "lead1", text: "Dạ chủ yếu mục kiểm tra viền cửa sổ với cân bằng trắng nội thất ạ" }
        ]
      },
      { by: "acc1", text: "Tuần này có thêm 2 khách cũ quay lại đặt đơn đều, số đơn tăng 6% so với tuần trước", gap: 8 },
      { by: "boss", text: "Tốt. Cuối tuần nghỉ ngơi, thứ 2 anh chốt các việc lớn", react: { "👍": ["acc1", "linh"] } }
    ]
  },
  {
    where: { channel: "ban-dieu-hanh" }, date: "2026-10-10", time: "16:20",
    lines: [
      {
        by: "linh",
        text: "@{boss} em đã gửi ngân sách 2027 v2, có thêm kịch bản xấu và điểm hoà vốn khi thuê tầng 3. Anh xem giúp em trước buổi họp thứ 2 nhé",
        files: [{ name: "ngan-sach-2027-v2.xlsx", hint: "updated budget with worst-case scenario and break-even chart" }]
      },
      {
        by: "acc1",
        text: "@{boss} khách Nhật vừa phản hồi sơ bộ: rất hài lòng với độ chính xác của viền, muốn bàn thêm về lượng đơn hàng tháng. Em đề xuất gọi video với họ thứ 3, anh tham gia được không ạ?",
        react: { "🎉": ["linh", "lead1"], "🔥": ["admin"] }
      },
      {
        by: "admin", text: "@{boss} phương án 20/10 em gửi kèm, cần anh duyệt trước thứ 4 để kịp đặt hoa và tiệc ạ",
        files: [{ name: "phuong-an-20-10.pdf", hint: "Women's Day plan: flowers, gifts, lunch buffet, short agenda" }]
      },
      { by: "lead1", text: "@{boss} thứ 2 anh ghé ca A gặp 3 bạn thử việc mới 5 phút được không ạ, các bạn rất mong gặp anh", react: { "❤️": ["linh"] } },
      { by: "linh", text: "Chắc hôm nay anh đang bận, mọi người để anh xem tối nay nhé 😄" }
    ]
  },
];
