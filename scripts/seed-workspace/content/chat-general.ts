/**
 * Chat seed content — #chung and #thong-bao (INVENTED, local test data only).
 * Office life of a fictional photo-retouch company, 2026-08-25 → 2026-10-10.
 */
import type { ChatScene, ConversationRef } from "../types.js";

/** Joins rows with a newline (mini-markup: blank row = new paragraph). */
const L = (...rows: string[]): string => rows.join("\n");

const CHUNG: ConversationRef = { channel: "chung" };
const TB: ConversationRef = { channel: "thong-bao" };

// #chung ----------------------------------------------------------------------------------------------

const chung: ChatScene[] = [
  // 25/8 — ngày đầu dùng Nesso Work
  {
    where: CHUNG, date: "2026-08-25", time: "08:32",
    lines: [
      {
        by: "boss",
        text: "Chào cả nhà 👋 Từ hôm nay mình trao đổi chung ở kênh này nhé. Nhóm Zalo công ty anh sẽ chuyển sang chỉ đọc từ cuối tuần.",
        react: { "🎉": ["linh", "admin", "an", "nv03", "nv07", "lead1"], "👍": ["minh", "khoa", "acc1"] }
      },
      { by: "nv03", gap: 2, text: "Ơ vào được rồi nè 😆 test test" },
      { by: "nv07", gap: 1, text: "Em đăng nhập trên điện thoại được luôn, nhìn xịn ghê" },
      { by: "an", gap: 2, text: "Giao diện dễ nhìn ghê, mà sao ảnh đại diện của em bị mờ mờ vậy ta" },
      { by: "minh", gap: 3, text: "Ảnh đại diện để file vuông tầm 400x400 là nét nha An. Vào **Hồ sơ cá nhân** ở góc dưới bên trái để đổi." },
      {
        by: "nv12", gap: 4,
        text: "Anh Minh ơi tên hiển thị của em đang là mã nhân viên, đổi được không anh?",
        thread: [
          { by: "minh", gap: 3, text: "Được em, cũng trong Hồ sơ. Mọi người để dạng `Tên - Ca A` hoặc `Tên - Bộ phận` cho dễ tìm nhé." },
          { by: "nv12", gap: 5, text: "Dạ em đổi rồi, cảm ơn anh" },
          { by: "lead1", gap: 2, text: "Ca A đổi hết giúp mình luôn nha mấy bạn" }
        ]
      },
      { by: "loc", gap: 3, text: "Mấy nhóm Zalo cũ còn dùng nữa không anh chị?" },
      {
        by: "linh", gap: 2,
        text: "Zalo chỉ giữ để liên lạc gấp ngoài giờ thôi em. Việc, file, đơn hàng từ nay đi qua Nesso Work hết nhé.",
        react: { "👍": ["loc", "nv01", "nv05", "lead2"] }
      },
      {
        by: "hanh", gap: 6,
        text: "Dạ em là Hạnh, thực tập sinh marketing ạ. Lần đầu dùng phần mềm này, có gì mong mọi người chỉ giáo 🙏",
        react: { "❤️": ["an", "linh", "nv09"] }
      },
      { by: "boss", gap: 2, text: "Chào Hạnh. Có gì chưa rõ cứ hỏi thẳng trong kênh này, đừng ngại." }
    ]
  },
  {
    where: CHUNG, date: "2026-08-25", time: "14:05",
    lines: [
      {
        by: "nv05",
        text: "Cho em hỏi xíu, tắt thông báo kênh tán gẫu sao ạ, điện thoại em kêu liên tục 😅",
        thread: [
          { by: "minh", gap: 4, text: "Bấm vào tên kênh → **Thông báo** → chọn **Chỉ khi được nhắc tên**. Riêng #thong-bao thì đừng tắt nha." },
          { by: "nv05", gap: 3, text: "Dạ được rồi, cảm ơn anh Minh 🙏" }
        ]
      },
      {
        by: "acc2", gap: 8,
        text: "Mọi người nhớ muốn tag ai thì gõ @ rồi chọn tên trong danh sách nha, gõ tay thì người ta không nhận được thông báo đâu",
        react: { "👍": ["nv10", "nv14", "linh"] }
      },
      { by: "nv10", gap: 2, text: "Tag cả nhóm một lần được không ạ?" },
      { by: "acc2", gap: 3, text: "Cái này em chưa thử, @{minh} ơi?" },
      {
        by: "minh", gap: 4,
        text: "Hiện tại tag từng người thôi, cả nhóm thì nhắn trong kênh riêng của nhóm. Anh ghi nhận để đề xuất thêm tính năng nhé.",
        react: { "👍": ["acc2", "nv10"] }
      },
      {
        by: "khoa", gap: 10,
        text: "Bên QC từ mai báo lỗi trong task luôn, không chụp màn hình gửi riêng nữa nha mọi người.",
        edited: "Bên QC từ mai báo lỗi **trong task** luôn, không chụp màn hình gửi riêng nữa nha mọi người. Sửa xong thì chuyển lại trạng thái **Chờ QC**.",
        react: { "✅": ["lead1", "lead2", "nv02"], "👀": ["nv08"] }
      },
      { by: "nv08", gap: 1, text: "Dạ anh 😬" }
    ]
  },
  // 26/8
  {
    where: CHUNG, date: "2026-08-26", time: "09:12",
    lines: [
      {
        by: "admin",
        text: "Ai đặt hàng online giao về công ty thì xuống lễ tân nhận nha, có 3 gói để ở quầy từ sáng.",
        thread: [
          { by: "nv14", gap: 3, text: "Gói màu đen ghi ca B là của em ạ, trưa em xuống lấy" },
          { by: "an", gap: 2, text: "Có cái ống tranh dài dài không ạ, của em đó 😁" },
          { by: "nv06", gap: 4, text: "Gói còn lại chắc của em, đế tản nhiệt laptop" }
        ]
      },
      {
        by: "admin", gap: 12,
        text: "Lần sau mọi người ghi rõ tên + bộ phận trên đơn giúp mình nha, hôm qua lễ tân gọi muốn khản cổ 😂",
        react: { "😂": ["an", "nv14", "nv03"], "🙏": ["linh"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-08-26", time: "16:25",
    lines: [
      { by: "nv09", text: "Có ai dư sạc Type-C cho em mượn tới cuối ca không, quên ở nhà rồi 😭" },
      { by: "nv11", gap: 2, text: "Bàn em có 1 cái, qua lấy nha, nhớ trả trước 22h" },
      { by: "nv09", gap: 1, text: "Cứu tinh đây rồi 🙏" },
      {
        by: "admin", gap: 9,
        text: "Phòng hành chính có 2 sạc dùng chung để trong tủ, ai cần mượn thì ghi sổ ở quầy nha",
        react: { "👍": ["nv09", "nv11", "nv02", "acc1"] }
      }
    ]
  },
  // 27/8
  {
    where: CHUNG, date: "2026-08-27", time: "10:35",
    lines: [
      { by: "nv13", text: "Cho em xin mẫu đơn xin nghỉ phép với ạ, em tìm trên NAS không thấy" },
      {
        by: "admin", gap: 4,
        text: "Đây nha. Nghỉ dưới 1 ngày chỉ cần báo trưởng ca + ghi lịch ca, từ 1 ngày trở lên mới cần làm đơn.",
        files: [{ name: "Mau-don-xin-nghi-phep-2026.docx", hint: "mẫu đơn xin nghỉ phép của công ty, có ô ký xác nhận trưởng ca" }],
        react: { "🙏": ["nv13", "nv04"] }
      },
      { by: "nv13", gap: 2, text: "Dạ em cảm ơn ạ" },
      {
        by: "lead2", gap: 5,
        text: "Ca B nghỉ thì báo mình trước ít nhất 2 ngày nha, trừ trường hợp ốm đột xuất.",
        react: { "✅": ["nv06", "nv10"] }
      },
      {
        by: "admin", gap: 6,
        text: "Mình để mẫu ở thư mục HC trên NAS rồi nha",
        edited: "Mình đã để tất cả biểu mẫu trong dự án **Hành chính – Nhân sự**, mục Tài liệu → Biểu mẫu, mọi người tự tải nha"
      }
    ]
  },
  {
    where: CHUNG, date: "2026-08-27", time: "15:10",
    lines: [
      {
        by: "nv01",
        text: "Đính kèm file vào task có giới hạn dung lượng không mọi người? Em up ảnh gốc RAW bị báo lỗi",
        thread: [
          { by: "minh", gap: 5, text: "Có giới hạn em. Ảnh gốc, file PSD nặng thì để trên NAS, trong task chỉ dán đường dẫn thư mục thôi." },
          { by: "khoa", gap: 3, text: "Đúng rồi, trong task chỉ cần ảnh JPG nhỏ để QC xem nhanh là đủ." },
          { by: "nv01", gap: 2, text: "Dạ em hiểu rồi ạ" }
        ]
      },
      {
        by: "nv07", gap: 15,
        text: "Mà trong task xem trước ảnh được luôn nha, khỏi tải về, tiện ghê",
        react: { "🔥": ["nv01", "an"] }
      },
      {
        by: "linh", gap: 4,
        text: "Tuần đầu dùng thấy chỗ nào bất tiện thì mọi người ghi lại, cuối tuần chị tổng hợp gửi anh Minh nhé.",
        react: { "👍": ["minh", "nv07", "acc1"] }
      }
    ]
  },
  // 28/8
  {
    where: CHUNG, date: "2026-08-28", time: "08:05",
    lines: [
      { by: "nv02", text: "Phòng sản xuất lầu 2 máy lạnh nhỏ nước xuống bàn em nè 😩" },
      { by: "nv04", gap: 1, text: "Bàn bên cạnh cũng bị, em phải dời màn hình rồi" },
      { by: "lead1", gap: 2, text: "@{admin} báo bảo trì giúp mình với, dãy gần cửa sổ của ca A bị hết" },
      { by: "admin", gap: 3, text: "Mình gọi thợ rồi, 10h họ tới. Tạm thời mọi người kê khăn và đừng để ổ điện dưới đó nha." },
      {
        by: "minh", gap: 2,
        text: "Máy nào gần đó thì rút ổ cắm sàn trước giùm anh, an toàn là trên hết",
        react: { "👍": ["lead1", "nv02", "nv04"] }
      },
      {
        by: "admin", gap: 140,
        text: "Thợ xử lý xong rồi nha, do ống thoát nước bị tắc. Ai còn thấy nhỏ nước thì báo mình.",
        react: { "🙏": ["nv02", "nv04", "lead1"], "👏": ["boss"] }
      },
      { by: "nv02", gap: 4, text: "Hết rồi ạ, khô ráo 👌" }
    ]
  },
  // 29/8 (thứ 7)
  {
    where: CHUNG, date: "2026-08-29", time: "07:55",
    lines: [
      { by: "admin", text: "Nhắc nhẹ: thứ 7 khối văn phòng làm tới 12h, sản xuất theo ca như bình thường. Ai về sau cùng bên văn phòng thì tắt đèn + máy lạnh phòng họp giúp mình nha." },
      { by: "acc1", gap: 6, text: "Chiều nay account có em trực tới 16h vì khách Úc gửi đơn trễ, em sẽ khoá cửa phòng." },
      { by: "nv01", gap: 4, text: "Thứ 7 được mặc đồ tự do không ạ 😁" },
      {
        by: "linh", gap: 3,
        text: "Được em, gọn gàng lịch sự là được. Hôm nào có khách đến thăm chị sẽ báo trước.",
        react: { "👍": ["nv01", "nv03"] }
      },
      { by: "nv01", gap: 1, text: "Dạ hihi 😆" }
    ]
  },
  // 31/8
  {
    where: CHUNG, date: "2026-08-31", time: "08:40",
    lines: [
      {
        by: "admin",
        text: L(
          "Thông báo bãi xe: từ tháng 9 tầng hầm đổi sang **thẻ từ mới**. Mọi người nộp thẻ cũ ở quầy lễ tân trước thứ 5 (3/9) để đổi nha.",
          "",
          "Nhớ dựng xe sát vạch giúp mình, bảo vệ phản ánh sáng nào cũng có xe chắn lối ra 😅"
        ),
        react: { "👀": ["nv06", "nv10", "nv15"] },
        thread: [
          { by: "nv06", gap: 6, text: "Thẻ mới có mất phí không ạ?" },
          { by: "admin", gap: 3, text: "Không mất phí em, làm mất thẻ thì mới phải làm lại thôi." },
          { by: "nv10", gap: 9, text: "Ca chiều ra về 22h thì cổng sau còn mở không ạ?" },
          { by: "admin", gap: 4, text: "Cổng sau mở tới 23h, sau giờ đó gọi bảo vệ ở chốt nha." }
        ]
      },
      { by: "nv15", gap: 6, text: "Em làm mất thẻ cũ rồi thì sao ạ 🥲" },
      { by: "admin", gap: 3, text: "Em qua quầy ghi tên, mình làm thẻ mới cho, lần này giữ kỹ nha 😄" },
      {
        by: "loc", gap: 5,
        text: "Xe em toàn bị kẹp giữa 2 chiếc tay ga to, ngày nào cũng phải nhờ bảo vệ kéo ra 😂",
        react: { "😂": ["nv03", "nv06", "nv15"] }
      }
    ]
  },
  // 3/9 — đi làm lại sau lễ
  {
    where: CHUNG, date: "2026-09-03", time: "08:35",
    lines: [
      {
        by: "linh",
        text: "Chào mừng cả nhà quay lại sau lễ ☀️ Cảm ơn ca trực 1–2/9 đã giữ đơn Úc đúng hạn, không trễ file nào.",
        react: { "❤️": ["boss", "lead1", "nv05", "nv08"], "👏": ["an", "khoa", "acc1"] }
      },
      {
        by: "boss", gap: 3,
        text: "Cảm ơn @{lead1} @{nv05} @{nv08} @{nv11}. Tháng này anh mời cả ca trực một bữa nhé.",
        react: { "🎉": ["nv05", "nv08", "nv11", "lead1"] }
      },
      { by: "nv08", gap: 2, text: "Dạ em cảm ơn anh 😍 ngày lễ đơn cũng vừa phải nên nhẹ nhàng ạ" },
      {
        by: "nv11", gap: 1,
        text: "Đã ghi nhận lời hứa của sếp 😆",
        react: { "😂": ["nv03", "nv07", "an", "boss"] }
      },
      { by: "nv03", gap: 4, text: "Về quê 2 ngày ăn tăng 2kg, nay ngồi máy thấy nặng nề hẳn 😂" },
      {
        by: "acc1", gap: 7,
        text: "Sáng nay khách Úc gửi lời cảm ơn vì giao đúng hạn cả ngày lễ, em forward vào task đơn rồi nha.",
        react: { "🔥": ["boss", "linh", "lead1"] }
      }
    ]
  },
  // 4/9
  {
    where: CHUNG, date: "2026-09-04", time: "14:10",
    lines: [
      {
        by: "linh",
        text: L(
          "Thứ 3 tuần sau (8/9) có đoàn khách đối tác đến thăm văn phòng khoảng 9h–10h30.",
          "- Mọi người dọn bàn gọn giúp chị",
          "- Màn hình đang làm ảnh thì bình thường, nhưng **không mở file của khách khác trên màn hình phụ** khi đoàn đi qua",
          "- Phòng họp lớn khoá từ 8h30 tới 11h"
        ),
        react: { "👍": ["admin", "khoa", "lead1", "nv07"] },
        thread: [
          { by: "nv07", gap: 5, text: "Có cần mặc áo công ty không chị?" },
          { by: "linh", gap: 3, text: "Ai có áo công ty thì mặc nha, không bắt buộc." },
          { by: "nv14", gap: 6, text: "Đoàn có chụp ảnh không chị, để em né 😅" },
          { by: "linh", gap: 4, text: "Có thể chụp vài tấm khu làm việc, ai ngại thì nói chị trước nhé." }
        ]
      },
      { by: "khoa", gap: 12, text: "@{boss} bên QC chuẩn bị sẵn 2 bộ before/after để demo cho khách nếu cần ạ" },
      {
        by: "boss", gap: 5,
        text: "Tốt. Em chọn bộ HDR với virtual staging nhé, khách quan tâm 2 mảng đó.",
        react: { "👍": ["khoa", "linh"] }
      },
      { by: "khoa", gap: 1, text: "Dạ ok anh." }
    ]
  },
  // 5/9 (thứ 7)
  {
    where: CHUNG, date: "2026-09-05", time: "10:30",
    lines: [
      { by: "admin", text: "Ai để quên tai nghe màu trắng ở phòng ăn lầu 1 vậy, mình cất ở quầy lễ tân nha 🎧" },
      {
        by: "nv13", gap: 4,
        text: "Của em ạaa, tìm cả sáng nay 😭 cảm ơn nhiều ạ",
        react: { "😂": ["nv12", "admin"] }
      },
      {
        by: "nv12", gap: 3,
        text: "Tuần trước bạn để quên ví, tuần này tai nghe, tuần sau chắc quên luôn… mình 😂",
        react: { "😂": ["nv13", "nv03", "an"] }
      },
      { by: "nv13", gap: 1, text: "Đừng nói gở 😤" }
    ]
  },
  // 7/9
  {
    where: CHUNG, date: "2026-09-07", time: "10:05",
    lines: [
      {
        by: "nv13",
        text: "Mọi người ơi ghim tin nhắn trong kênh sao vậy, em muốn ghim cái lịch ca",
        thread: [
          {
            by: "an", gap: 2,
            text: "Rê chuột vào tin nhắn → bấm dấu 3 chấm → **Ghim**. Trên điện thoại thì nhấn giữ tin nhắn nha",
            edited: "Rê chuột vào tin nhắn → bấm dấu 3 chấm → **Ghim tin nhắn**. Trên điện thoại thì nhấn giữ tin nhắn là thấy nha",
            react: { "🙏": ["nv13"] }
          },
          { by: "nv13", gap: 3, text: "Ra rồi, cảm ơn An nha" }
        ]
      },
      { by: "acc2", gap: 10, text: "Có ai bị không nhận thông báo trên điện thoại không, em phải mở app ra mới thấy tin" },
      { by: "minh", gap: 3, text: "Em vào cài đặt điện thoại cho phép thông báo chưa? Cho rồi mà vẫn không có thì chụp màn hình gửi anh ở #it-ho-tro nha" },
      {
        by: "acc2", gap: 6,
        text: "Bật lại thì có rồi ạ, do lúc đầu em lỡ bấm Chặn 🙈",
        react: { "😂": ["minh", "nv13"] }
      },
      { by: "nv04", gap: 5, text: "Tìm tin nhắn cũ thì gõ vào ô tìm kiếm trên cùng là ra hả mọi người? Tiện hơn lướt Zalo nhiều" },
      {
        by: "minh", gap: 2,
        text: "Đúng rồi, tìm được cả file đính kèm nữa.",
        react: { "👍": ["nv04", "nv13"], "🔥": ["an"] }
      }
    ]
  },
  // 8/9 — khách đến thăm
  {
    where: CHUNG, date: "2026-09-08", time: "08:50",
    lines: [
      { by: "linh", text: "9h đoàn khách tới nha cả nhà, giữ trật tự giúp chị. Phòng họp lớn khoá tới 11h." },
      {
        by: "admin", gap: 3,
        text: "Lễ tân đã chuẩn bị nước + bảng tên khách, ai đi muộn thì vào cửa sau giúp mình nha",
        react: { "👍": ["linh", "nv09"] }
      },
      {
        by: "boss", gap: 105,
        text: "Buổi thăm ổn. Khách khen khu làm việc gọn và quy trình QC rõ ràng. Cảm ơn mọi người đã phối hợp 👍",
        react: { "👏": ["linh", "khoa", "admin", "an", "nv02", "nv07"], "❤️": ["lead1"] },
        thread: [
          { by: "khoa", gap: 6, text: "Khách hỏi kỹ phần kiểm tra viền cắt, em đã gửi tài liệu cho bên account ạ" },
          { by: "acc1", gap: 4, text: "Dạ em nhận, chiều em gửi bản giới thiệu quy trình cho khách luôn ạ." },
          { by: "boss", gap: 3, text: "Ok, gửi xong cc anh trong task nhé." }
        ]
      },
      {
        by: "nv07", gap: 6,
        text: "Lúc đoàn đi ngang em run quá, sửa nhầm layer luôn 😂",
        react: { "😂": ["nv02", "nv09", "an", "linh"] }
      }
    ]
  },
  // 9/9 — sinh nhật nv04
  {
    where: CHUNG, date: "2026-09-09", time: "08:15",
    lines: [
      {
        by: "admin",
        text: "Hôm nay sinh nhật @{nv04} nè cả nhà 🎂🎉 Chúc tuổi mới thật vui, khoẻ, tay nghề lên level!",
        react: { "🎉": ["boss", "linh", "nv01", "nv02", "nv03", "an"], "❤️": ["nv04", "lead1", "khoa"] }
      },
      { by: "boss", gap: 3, text: "Chúc mừng sinh nhật em! Tuổi mới nhiều niềm vui nhé." },
      { by: "nv02", gap: 1, text: "HPBD bạn yêu 🥳" },
      { by: "lead1", gap: 2, text: "Sinh nhật vui vẻ nha, chiều nay ca A có bánh đó" },
      { by: "an", gap: 2, text: "Happy birthday 🎈" },
      {
        by: "loc", gap: 3,
        text: "Chúc mừng sinh nhật nha bạn, tuổi mới ít bị khách trả ảnh 😂",
        react: { "😂": ["nv04", "nv03", "nv06", "khoa"] }
      },
      {
        by: "nv04", gap: 6,
        text: "Em cảm ơn anh chị và mọi người nhiều lắm ạ 🥹❤️ 16h mời cả phòng ăn bánh nha",
        react: { "❤️": ["nv02", "admin", "linh", "nv12"] }
      },
      { by: "nv12", gap: 1, text: "Đã đặt lịch 16h 😋" }
    ]
  },
  // 10/9 — nghỉ phép ngắn
  {
    where: CHUNG, date: "2026-09-10", time: "11:20",
    lines: [
      {
        by: "nv07",
        text: "Em xin nghỉ phép chiều mai (11/9) đi khám răng ạ. Đơn em gửi @{lead1} rồi, job khách Mỹ đang làm em bàn giao cho @{nv08}.",
        thread: [
          { by: "lead1", gap: 4, text: "Ok em, nhớ ghi lên lịch ca nha." },
          { by: "nv08", gap: 3, text: "Ok bạn, nhắn mình đường dẫn thư mục trước 17h nha" },
          { by: "nv07", gap: 2, text: "Gửi rồi nè 👍" }
        ]
      },
      {
        by: "linh", gap: 15,
        text: "Mọi người lưu ý: nghỉ phép ngắn thì ghi thêm vào **Lịch nghỉ** trong dự án Hành chính – Nhân sự giúp chị, tránh trùng nhiều người cùng ca nhé.",
        react: { "✅": ["admin", "lead2", "nv07"] }
      }
    ]
  },
  // 11/9 — chia tay Lộc
  {
    where: CHUNG, date: "2026-09-11", time: "16:40",
    lines: [
      {
        by: "loc",
        text: L(
          "Hôm nay là ngày làm việc cuối của em ở công ty rồi ạ. Cảm ơn anh chị và mọi người đã chỉ dạy em suốt hơn 2 năm, từ hồi mask tóc còn lem nhem tới giờ 😅",
          "",
          "Em chuyển ra Bắc sống với gia đình, ai ra ngoài đó nhớ nhắn em nha ❤️"
        ),
        react: { "❤️": ["boss", "linh", "khoa", "lead1", "nv03", "nv06"], "😢": ["nv01", "nv02", "nv09", "an"] },
        thread: [
          { by: "boss", gap: 5, text: "Cảm ơn Lộc đã đồng hành. Có dịp vào lại Sài Gòn thì ghé công ty nhé, cửa luôn mở." },
          { by: "nv03", gap: 2, text: "Nhớ ông lắm luôn đó 😭" },
          { by: "khoa", gap: 4, text: "Đi mạnh giỏi nha em. Tay nghề vững rồi, cứ tự tin." },
          { by: "loc", gap: 3, text: "Dạ em cảm ơn anh, em sẽ nhớ mọi người lắm 🙏" }
        ]
      },
      {
        by: "linh", gap: 4,
        text: "17h mọi người xuống phòng ăn chia tay Lộc nha, có bánh + trà sữa",
        react: { "👍": ["admin", "nv06", "nv10"] }
      },
      { by: "nv06", gap: 2, text: "Ca B xin 15 phút xuống chung vui nhé @{lead2}" },
      { by: "lead2", gap: 1, text: "Ok, xuống theo 2 đợt để máy không trống nha" },
      {
        by: "an", gap: 85,
        text: "Ảnh chung đây nha mọi người 📸",
        files: [{ name: "chia-tay-loc.jpg", hint: "ảnh nhóm cả phòng chụp chung buổi chia tay đồng nghiệp, có bánh kem trên bàn" }],
        react: { "❤️": ["loc", "linh", "nv02", "nv09"], "🎉": ["admin"] }
      },
      { by: "loc", gap: 3, text: "Đẹp quá, em lưu làm kỷ niệm luôn 🥹" }
    ]
  },
  // 14/9 — tuần cao điểm đơn Úc
  {
    where: CHUNG, date: "2026-09-14", time: "07:50",
    lines: [
      {
        by: "admin",
        text: L(
          "Tuần này (14–19/9) sản xuất tăng ca cao điểm đơn Úc.",
          "- Công ty hỗ trợ **cơm tối** cho ai làm sau 19h",
          "- Đăng ký suất ăn với trưởng ca trước 15h mỗi ngày",
          "- Phần chay ghi chú riêng giúp mình nha"
        ),
        react: { "🙏": ["nv10", "nv05", "lead1"] },
        thread: [
          { by: "nv10", gap: 7, text: "Ca đêm có đồ ăn khuya không ạ?" },
          { by: "admin", gap: 4, text: "Có em, phòng ăn có mì, sữa, trái cây cho ca đêm, giữa tuần mình bổ sung thêm." },
          { by: "lead2", gap: 3, text: "Ca B mình tổng hợp gửi lúc 14h30 mỗi ngày nhé" }
        ]
      },
      {
        by: "boss", gap: 10,
        text: "Tuần này vất vả cho mọi người. Ưu tiên chất lượng, đừng vì vội mà bỏ bước tự kiểm tra. Mệt thì báo trưởng ca nghỉ 10 phút.",
        react: { "💯": ["khoa", "linh", "lead1"], "👍": ["nv01", "nv05", "nv12", "acc1"] }
      },
      { by: "nv05", gap: 2, text: "Dạ anh, cả nhà chiến thôi 💪" },
      { by: "khoa", gap: 4, text: "Nhắc lại: **màu trời** và **cửa sổ** là 2 lỗi khách Úc hay bắt nhất. Trời không ám tím, cửa sổ phải thấy rõ cảnh bên ngoài." }
    ]
  },
  {
    where: CHUNG, date: "2026-09-15", time: "19:25",
    lines: [
      {
        by: "admin",
        text: "Cơm tối về rồi nha, để ở phòng ăn lầu 1. Có 2 phần chay cho @{nv12} và @{nv14}.",
        react: { "🙏": ["nv12", "nv14", "lead1"] }
      },
      { by: "nv12", gap: 2, text: "Dạ em cảm ơn ạ 🙏" },
      { by: "nv03", gap: 1, text: "Hôm nay có canh chua 🤤" },
      { by: "lead1", gap: 2, text: "Ca A xuống ăn theo lượt, mỗi lượt 4 người nha" },
      { by: "nv09", gap: 9, text: "Ai lấy nhầm hộp cơm có ghi chữ B không, của em 🥲" },
      {
        by: "nv11", gap: 3,
        text: "Lỗi mình, đem trả liền 😂",
        react: { "😂": ["nv09", "nv03", "admin"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-09-16", time: "10:20",
    lines: [
      {
        by: "nv01",
        text: "Ai có đầu đọc thẻ SD cho em mượn chút, khách gửi thẻ nhớ ảnh gốc qua đường bưu điện 😮",
        thread: [
          { by: "minh", gap: 3, text: "Phòng IT có, qua lấy nha. Chép xong đưa lên đúng thư mục đơn trên NAS rồi trả thẻ cho bên account cất." },
          { by: "acc1", gap: 4, text: "Thẻ đó em phải gửi trả khách cuối tuần, mọi người giữ cẩn thận giúp em nha 🙏" },
          { by: "nv01", gap: 2, text: "Dạ em làm xong trả lại liền ạ" }
        ]
      }
    ]
  },
  {
    where: CHUNG, date: "2026-09-17", time: "14:05",
    lines: [
      { by: "nv06", text: "Đèn dãy cuối phòng sản xuất nhấp nháy quá, nhìn màn hình chỉnh màu hơi khó ạ" },
      { by: "khoa", gap: 3, text: "Đúng rồi, ánh sáng không ổn là chỉnh màu lệch hết. @{admin} xử lý gấp giúp anh nha" },
      { by: "admin", gap: 4, text: "Mình báo kỹ thuật toà nhà rồi, 15h có người lên thay bóng." },
      {
        by: "admin", gap: 70,
        text: "Đã thay xong bóng dãy cuối nha mọi người",
        react: { "👍": ["nv06", "khoa", "nv10"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-09-18", time: "17:15",
    lines: [
      {
        by: "boss",
        text: "Tuần cao điểm sắp xong rồi. Chiều nay anh mời trà sữa cả công ty, @{admin} đặt giúp anh nhé. Ca đêm có phần riêng.",
        react: { "🎉": ["nv01", "nv02", "nv05", "nv07", "nv10", "an"], "❤️": ["linh", "lead1", "lead2"], "🔥": ["nv13"] }
      },
      {
        by: "admin", gap: 3,
        text: "Dạ em lên form chọn món, mọi người điền trước 17h45 nha: [Form chọn món](https://nesso.example/forms/tra-sua-18-9)",
        edited: "Dạ em lên form chọn món, mọi người điền trước **18h** nha (lùi 15 phút cho ca chiều kịp): [Form chọn món](https://nesso.example/forms/tra-sua-18-9)",
        react: { "👍": ["nv02", "nv13", "acc2"] }
      },
      { by: "nv02", gap: 1, text: "Sếp số dzách 🥰" },
      { by: "nv13", gap: 2, text: "Em ít đá ít ngọt nha, cảm ơn anh ạ" },
      {
        by: "acc2", gap: 2,
        text: "Mọi người điền vào form nha, đừng ghi ở đây kẻo sót đó 😂",
        react: { "😂": ["nv13", "admin"] }
      },
      { by: "lead2", gap: 4, text: "Ca đêm 4 người, mình điền rồi nhé" },
      { by: "admin", gap: 50, text: "Trà sữa tới rồi, xuống sảnh lấy theo tên trên ly nha 🧋" },
      {
        by: "nv07", gap: 6,
        text: "Ngon quá, cảm ơn sếp nhiều ạ 🙏",
        react: { "❤️": ["boss"] }
      }
    ]
  },
  // 19/9 (thứ 7) — trước khi chuyển NAS
  {
    where: CHUNG, date: "2026-09-19", time: "08:10",
    lines: [
      {
        by: "minh",
        text: "Nhắc mọi người: **từ 18h hôm nay** NAS cũ ngừng ghi để chuyển dữ liệu sang NAS mới. Ai đang làm dở thì lưu + đẩy file lên trước 17h30 nha. Chi tiết xem bên #thong-bao.",
        react: { "👀": ["lead1", "lead2", "nv04"], "👍": ["linh", "acc1"] },
        thread: [
          { by: "lead2", gap: 8, text: "Ca đêm tối nay làm trên ổ máy rồi sáng mai đẩy lên NAS mới được không anh?" },
          { by: "minh", gap: 4, text: "Được, anh tạo sẵn thư mục tạm trên từng máy. Sáng CN anh vào kiểm tra cùng ca trực." },
          { by: "lead2", gap: 2, text: "Ok anh, cảm ơn anh" }
        ]
      },
      { by: "nv10", gap: 12, text: "Thứ 2 có phải map ổ lại không anh?" },
      { by: "minh", gap: 3, text: "Có, anh sẽ gửi hướng dẫn 3 bước, mất 1 phút thôi." }
    ]
  },
  // 21/9 — sự cố phân quyền sau khi chuyển NAS
  {
    where: CHUNG, date: "2026-09-21", time: "08:15",
    lines: [
      { by: "nv04", text: "Sáng nay em không thấy thư mục đơn của ca A trên ổ mới, mọi người có bị không?" },
      {
        by: "nv02", gap: 1,
        text: "Em cũng không vào được, báo không có quyền truy cập 😵",
        files: [{ name: "loi-quyen-truy-cap-nas.png", hint: "hộp thoại báo không có quyền truy cập thư mục mạng trên NAS mới" }]
      },
      {
        by: "minh", gap: 3,
        text: "Do phân quyền nhóm chưa đồng bộ hết, anh đang sửa. Mọi người báo vào #it-ho-tro kèm ảnh lỗi giúp anh, đừng báo rải rác nha.",
        react: { "🙏": ["nv04", "nv02", "lead1"] }
      },
      { by: "lead1", gap: 2, text: "Ca A tạm làm các job đã tải về máy trước nhé, 9h mình cập nhật lại" },
      {
        by: "minh", gap: 50,
        text: "Ca A vào lại được rồi nha, ca B anh đang làm tiếp.",
        react: { "👍": ["nv04", "nv02", "lead1", "khoa"] }
      },
      { by: "nv04", gap: 2, text: "Vào được rồi anh ơi, cảm ơn anh 👍" }
    ]
  },
  {
    where: CHUNG, date: "2026-09-22", time: "11:05",
    lines: [
      {
        by: "hanh",
        text: "Cho em hỏi mẫu đề xuất mua sắm văn phòng phẩm ở đâu ạ? Bên marketing cần mua thêm giấy in ảnh mẫu",
        thread: [
          { by: "admin", gap: 4, text: "Trong dự án Hành chính – Nhân sự, mục Tài liệu → **Biểu mẫu** nha Hạnh. Điền xong gửi chị Linh duyệt rồi chuyển mình." },
          { by: "hanh", gap: 2, text: "Dạ em thấy rồi ạ, cảm ơn ạ" },
          { by: "an", gap: 3, text: "Hạnh ghi thêm 1 hộp băng keo 2 mặt giúp mình nha, sắp hết rồi" },
          { by: "hanh", gap: 1, text: "Dạ ok ạ 😁" }
        ]
      }
    ]
  },
  // 23/9 — sinh nhật chị Linh
  {
    where: CHUNG, date: "2026-09-23", time: "08:30",
    lines: [
      {
        by: "boss",
        text: "Hôm nay sinh nhật @{linh} 🎉 Cảm ơn em đã gánh vận hành cả công ty, chúc tuổi mới thật nhiều sức khoẻ và bình an.",
        react: { "🎉": ["admin", "an", "minh", "khoa", "lead1", "lead2"], "❤️": ["nv01", "nv02", "nv09", "acc1", "acc2", "hanh"] },
        thread: [
          { by: "linh", gap: 6, text: "Em cảm ơn anh và cả nhà nhiều ạ 🥰 Đi làm có cả đám em dễ thương vậy là vui rồi." },
          { by: "admin", gap: 4, text: "Trưa nay có bánh kem ở phòng họp nhỏ nha cả nhà, giữ bí mật giùm mình đến 11h45 😁" },
          { by: "an", gap: 1, text: "Ủa nói trong thread này chị Linh đọc được rồi kìa 😂" },
          { by: "admin", gap: 1, text: "Thôi chết 😂" }
        ]
      },
      { by: "an", gap: 3, text: "Chúc mừng sinh nhật chị Linh ạ, chúc chị luôn xinh và bớt bận 💐" },
      { by: "khoa", gap: 2, text: "Happy birthday chị, tuổi mới bớt bị tag lúc 10h đêm 😆" },
      { by: "minh", gap: 1, text: "Chúc mừng sinh nhật chị Linh 🎂" },
      { by: "acc1", gap: 3, text: "Mừng sinh nhật chị ạ, chúc chị luôn vui khoẻ ❤️" },
      { by: "nv09", gap: 2, text: "HPBD chị Linh 🎉🎉" },
      {
        by: "linh", gap: 10,
        text: "Cảm ơn mọi người nhiều nhaaa ❤️",
        react: { "❤️": ["boss", "an", "nv09"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-09-24", time: "15:30",
    lines: [
      {
        by: "admin",
        text: "Bánh trung thu về rồi nha, 60 hộp đang để ở phòng họp nhỏ. Ai rảnh 15 phút phụ mình chia theo danh sách được không?",
        react: { "🙏": ["linh"] },
        thread: [
          { by: "an", gap: 2, text: "Em xuống liền" },
          { by: "hanh", gap: 1, text: "Em nữa ạ" },
          { by: "nv14", gap: 3, text: "Ca chiều em ra phụ 10 phút được không @{lead2}" },
          { by: "lead2", gap: 2, text: "Đi đi em, nhớ quay lại job 45 ảnh nha 😄" }
        ]
      },
      {
        by: "admin", gap: 45,
        text: "Xong rồi nha, cảm ơn An, Hạnh và @{nv14} 🥮 Mai 16h30 phát kèm tiệc nhỏ ở sảnh.",
        react: { "👍": ["an", "hanh", "nv14"], "❤️": ["boss"] }
      }
    ]
  },
  // 25/9 — Trung thu
  {
    where: CHUNG, date: "2026-09-25", time: "16:20",
    lines: [
      { by: "admin", text: "16h30 xuống sảnh lầu 1 nha cả nhà, có bánh, trà và lồng đèn 🏮" },
      { by: "boss", gap: 2, text: "Ca nào đang gấp đơn thì xuống sau cũng được, phần bánh để riêng đủ người nhé." },
      { by: "nv03", gap: 3, text: "Ca B xuống đợt 2 lúc 17h nha mọi người" },
      {
        by: "an", gap: 25,
        text: "Vài tấm cho mọi người nè 🏮🥮",
        files: [
          { name: "trung-thu-2026-1.jpg", hint: "tiệc trung thu ở sảnh văn phòng, lồng đèn và bánh trung thu trên bàn" },
          { name: "trung-thu-2026-2.jpg", hint: "nhân viên cầm lồng đèn chụp ảnh nhóm" }
        ],
        react: { "❤️": ["linh", "admin", "nv01", "nv05", "nv09"], "🎉": ["boss", "hanh"] }
      },
      { by: "nv01", gap: 2, text: "Bánh trứng muối ngon xỉu 🤤" },
      {
        by: "hanh", gap: 3,
        text: "Lần đầu em được dự Trung thu công ty, vui quá ạ 🥹",
        react: { "❤️": ["linh", "an", "admin"] }
      },
      { by: "nv05", gap: 4, text: "Lồng đèn cá chép của ai làm mà đẹp vậy" },
      {
        by: "an", gap: 1,
        text: "Em với Hạnh làm đó, tự hào xíu 😎",
        react: { "👏": ["nv05", "nv07", "boss", "linh"] }
      },
      {
        by: "boss", gap: 6,
        text: "Bánh năm nay ngon đấy, @{admin} chọn chuẩn 👍",
        react: { "😂": ["admin"], "👍": ["nv03", "nv12"] }
      }
    ]
  },
  // 28/9 — sau team building
  {
    where: CHUNG, date: "2026-09-28", time: "08:30",
    lines: [
      { by: "nv09", text: "Đi Vũng Tàu về mà người vẫn còn say sóng 😵‍💫" },
      { by: "nv02", gap: 2, text: "Chân em còn đau vì trò kéo co 😂" },
      {
        by: "an", gap: 4,
        text: "Album ảnh team building em up lên rồi nha: [Album Vũng Tàu 26–27/9](https://nesso.example/album/team-building-2026)",
        react: { "🔥": ["nv02", "nv09", "admin", "linh"], "❤️": ["boss", "nv05", "nv11"] }
      },
      { by: "linh", gap: 5, text: "Cảm ơn ban tổ chức @{admin} @{nv02} @{nv09} và An nhé, chuyến đi vui mà an toàn tuyệt đối 👏" },
      {
        by: "boss", gap: 3,
        text: "Đồng ý. Đội tổ chức làm rất chuyên nghiệp. Năm sau mình đi xa hơn nhé 😄",
        react: { "🎉": ["nv02", "nv09", "admin", "an", "nv03", "nv12"] }
      },
      {
        by: "nv12", gap: 1,
        text: "Sếp hứa rồi nha, mọi người làm chứng 😆",
        react: { "😂": ["nv03", "nv07", "boss"] }
      },
      { by: "nv05", gap: 6, text: "Ai có ảnh nhảy flashmob tối gala gửi em xin với, em bị cắt mất nửa mặt trong album 🥲" }
    ]
  },
  // 29/9
  {
    where: CHUNG, date: "2026-09-29", time: "10:00",
    lines: [
      {
        by: "admin",
        text: "Nhắc lần 2: mọi người kiểm tra **bảng chấm công tháng 9** và phản hồi sai sót trước 17h ngày mai (30/9) nha. Sau đó mình chốt gửi kế toán.",
        react: { "👀": ["nv01", "nv06"], "✅": ["lead1", "lead2"] },
        thread: [
          { by: "nv01", gap: 8, text: "Tuần cao điểm em tăng ca 3 tối mà bảng mới ghi 2 ạ" },
          { by: "admin", gap: 5, text: "Để mình đối chiếu với trưởng ca, chiều nay báo lại em nha." },
          { by: "nv10", gap: 6, text: "Xem bảng công ở đâu vậy ạ?" },
          { by: "admin", gap: 3, text: "Mỗi người có 1 task riêng tên **Chấm công T9 – [tên]** trong dự án Hành chính – Nhân sự, file đính kèm trong đó nha." },
          { by: "nv10", gap: 2, text: "Dạ em thấy rồi ạ" }
        ]
      },
      { by: "nv13", gap: 20, text: "Em đi trễ 2 lần đều có báo trưởng ca, có cần làm giải trình không ạ?" },
      { by: "admin", gap: 4, text: "Có báo trước thì trưởng ca xác nhận trên task là được, không cần giấy nha." }
    ]
  },
  {
    where: CHUNG, date: "2026-09-29", time: "16:30",
    lines: [
      {
        by: "hanh",
        text: L(
          "Thứ 4 là ngày cuối thực tập của em, nhưng mai em phải lên trường nộp hồ sơ nên hôm nay em chào mọi người luôn ạ 🥲",
          "",
          "3 tháng ở đây em học được rất nhiều, từ viết content tới hiểu nghề retouch. Cảm ơn chị Linh, An, anh Minh và mọi người đã kiên nhẫn với em. Chúc công ty ngày càng phát triển ạ 🙏"
        ),
        react: { "❤️": ["an", "linh", "minh", "boss", "admin", "nv09"], "😢": ["an", "nv02"] },
        thread: [
          { by: "an", gap: 3, text: "Hạnh giỏi lắm, sau này cần portfolio cứ lấy mấy bài fanpage em làm nha" },
          { by: "boss", gap: 6, text: "Cảm ơn Hạnh. Em làm việc chăm và cầu tiến. Tốt nghiệp xong nếu muốn quay lại thì nhắn anh hoặc chị Linh." },
          { by: "hanh", gap: 2, text: "Dạ em cảm ơn anh nhiều lắm ạ 🥹" },
          { by: "linh", gap: 4, text: "Giữ liên lạc nha em, giấy xác nhận thực tập chị ký xong gửi em trong tuần này." }
        ]
      },
      { by: "minh", gap: 10, text: "Chúc Hạnh bảo vệ tốt nghiệp suôn sẻ nhé 🎓" },
      { by: "nv09", gap: 2, text: "Nhớ Hạnh lắm á, mấy bữa trưa thiếu người buôn chuyện 😢" },
      { by: "hanh", gap: 3, text: "Em sẽ ghé chơi ạ ❤️" }
    ]
  },
  // 1/10 — mẹo dùng Nesso Work
  {
    where: CHUNG, date: "2026-10-01", time: "09:15",
    lines: [
      {
        by: "nv11",
        text: "Ai chỉ em cách xem hết task của mình ở mọi dự án với, em mở từng dự án mệt quá",
        thread: [
          { by: "linh", gap: 3, text: "Vào mục **Việc của tôi** ở thanh bên trái em, lọc theo hạn là thấy hết." },
          {
            by: "nv11", gap: 2,
            text: "Ồ có luôn hả chị, dùng 1 tháng giờ em mới biết 😅",
            react: { "😂": ["nv03", "an", "linh"] }
          }
        ]
      },
      {
        by: "lead2", gap: 10,
        text: "Mọi người cũng nên bật xem dạng **Bảng** trong dự án sản xuất, kéo thả trạng thái nhanh hơn nhiều",
        react: { "👍": ["nv11", "nv14"] }
      },
      { by: "nv15", gap: 3, text: "Kéo sang Chờ QC xong thì QC có nhận thông báo không ạ?" },
      {
        by: "khoa", gap: 2,
        text: "Có, anh với mấy bạn QC đều được báo. Kéo xong nhớ gắn link file thành phẩm vào task nha.",
        react: { "👍": ["nv15", "lead2"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-10-02", time: "14:20",
    lines: [
      {
        by: "admin",
        text: "Văn phòng phẩm quý 4 về rồi: bút, sổ, giấy note, pin chuột. Ai cần ghé quầy lấy và ký sổ nha.",
        thread: [
          { by: "nv08", gap: 3, text: "Pin chuột còn không ạ, chuột em sắp hết pin" },
          { by: "admin", gap: 2, text: "Còn nhiều nha em" },
          { by: "acc2", gap: 4, text: "Cho em xin 2 cuốn sổ cho bên account với ạ" },
          { by: "an", gap: 5, text: "Có bút lông màu không ạ 🙏" },
          { by: "admin", gap: 3, text: "Bút lông chưa có An ơi, đợt sau mình đặt thêm" }
        ]
      }
    ]
  },
  // 3/10 (thứ 7)
  {
    where: CHUNG, date: "2026-10-03", time: "08:25",
    lines: [
      { by: "nv07", text: "Sáng thứ 7 máy lạnh phòng sản xuất chưa bật hả mọi người, nóng quá 🥵" },
      { by: "lead1", gap: 2, text: "Bảo vệ bật tổng lúc 8h, chắc trễ chút. Mình gọi rồi." },
      { by: "nv07", gap: 12, text: "Mát rồi ạ 😌" },
      {
        by: "acc1", gap: 20,
        text: "Ai về muộn nhất bên văn phòng nhớ tắt máy in giúp em nha, hôm trước để chạy qua đêm",
        react: { "👍": ["admin", "an"] }
      }
    ]
  },
  // 5/10 — lương + kickoff Q4
  {
    where: CHUNG, date: "2026-10-05", time: "08:20",
    lines: [
      {
        by: "nv05",
        text: "Lương về rồi mọi người ơi 🎉",
        react: { "🎉": ["nv01", "nv02", "nv03", "nv07", "nv10", "nv12"], "😂": ["an"] }
      },
      { by: "nv03", gap: 1, text: "Ting ting 💸 cảm ơn công ty ạ" },
      {
        by: "admin", gap: 4,
        text: "Mọi người có thắc mắc về lương thì nhắn riêng hành chính nha, đừng trao đổi ở kênh chung 🙏",
        react: { "👍": ["linh", "nv05", "nv03"], "🙏": ["nv12"] }
      },
      {
        by: "linh", gap: 2,
        text: "8h30 họp kickoff Q4 ở phòng họp lớn nha. Trưởng ca + QC + account bắt buộc, các bạn khác xem trực tuyến.",
        edited: "8h30 họp kickoff Q4 ở phòng họp lớn nha. Trưởng ca + QC + account + marketing bắt buộc, các bạn khác xem trực tuyến qua link trong #thong-bao."
      },
      { by: "lead1", gap: 3, text: "Ca A đang chạy job khách Mỹ, mình vào trễ 5 phút nhé chị" },
      { by: "linh", gap: 1, text: "Ok em" },
      {
        by: "boss", gap: 120,
        text: "Kickoff xong rồi. Slide và **checklist QC v2** chị Linh đã đăng ở #thong-bao, mọi người đọc kỹ trong tuần này nhé. Quý 4 mình tập trung **chất lượng ổn định** và **đào tạo người mới**.",
        react: { "💯": ["khoa", "linh", "lead2"], "👍": ["nv04", "nv08", "acc1", "acc2"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-10-05", time: "15:20",
    lines: [
      { by: "nv04", text: "Mẫu báo cáo tuần bản mới là file nào vậy ạ, em thấy trên NAS có 2 bản" },
      {
        by: "linh", gap: 5,
        text: "Dùng bản này nha, bản cũ chị xoá rồi. Từ tuần 41 có thêm cột lỗi theo checklist QC v2.",
        files: [{ name: "mau-bao-cao-tuan-v2.xlsx", hint: "mẫu báo cáo tuần sản xuất: số ảnh, tỉ lệ đúng hạn, lỗi theo checklist QC v2" }],
        react: { "👍": ["nv04", "lead1", "lead2"] }
      },
      { by: "nv04", gap: 2, text: "Dạ em cảm ơn chị" }
    ]
  },
  // 6/10 — sinh nhật lead1
  {
    where: CHUNG, date: "2026-10-06", time: "08:20",
    lines: [
      {
        by: "admin",
        text: "Hôm nay sinh nhật trưởng ca @{lead1} nè cả nhà 🎂 Chúc tuổi mới thật nhiều sức khoẻ, ca A luôn chạy mượt, khách không hối!",
        react: { "🎉": ["boss", "linh", "nv01", "nv04", "nv05", "khoa"], "❤️": ["lead2", "an", "acc1"] }
      },
      { by: "boss", gap: 3, text: "Chúc mừng sinh nhật em. Cảm ơn em đã giữ ca A chắc tay suốt tuần cao điểm." },
      { by: "nv01", gap: 1, text: "Chúc mừng sinh nhật trưởng ca của tụi em 🥳" },
      { by: "lead2", gap: 2, text: "HPBD đồng nghiệp, tối nay ca B trực thay 30 phút cho đi ăn bánh nha 😆" },
      { by: "nv04", gap: 2, text: "Ca A góp quà rồi nha, 15h tặng, mọi người giữ bí mật 🤫", deleted: true },
      { by: "nv04", gap: 1, text: "Ơ gửi nhầm chỗ 🙈" },
      {
        by: "lead1", gap: 4,
        text: "Cảm ơn sếp và cả nhà nhiều nha ❤️ Mà mình đọc được hết rồi đó 😂",
        react: { "😂": ["nv04", "nv01", "lead2", "an"] }
      }
    ]
  },
  // 7/10
  {
    where: CHUNG, date: "2026-10-07", time: "10:25",
    lines: [
      {
        by: "admin",
        text: "Từ hôm nay tới thứ 6 có ứng viên retoucher đến làm bài test lúc 9h và 14h. Phòng họp nhỏ dành cho test, mọi người đặt phòng khác giúp mình nha.",
        react: { "👍": ["linh", "khoa", "acc1"] }
      },
      { by: "khoa", gap: 4, text: "Bài test tuần này gồm 3 ảnh HDR + 1 ảnh cắt nền, QC chấm cùng trưởng ca." },
      {
        by: "nv10", gap: 6,
        text: "Em giới thiệu 1 bạn cùng trường, gửi CV cho ai vậy ạ?",
        thread: [
          { by: "admin", gap: 3, text: "Gửi mình qua tin nhắn riêng nha, nhớ ghi người giới thiệu là em." },
          { by: "nv10", gap: 2, text: "Dạ em gửi rồi ạ" }
        ]
      },
      {
        by: "nv13", gap: 5,
        text: "Em cũng có 2 bạn muốn ứng tuyển ca chiều ạ",
        react: { "🔥": ["admin", "lead2"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-10-07", time: "16:05",
    lines: [
      { by: "nv12", text: "Ai có sạc laptop đầu tròn nhỏ không ạ, sạc em vừa hỏng 😭" },
      { by: "minh", gap: 3, text: "Lên phòng IT lấy sạc dự phòng nha, mai mang sạc hỏng lên anh xem còn bảo hành không" },
      { by: "nv12", gap: 2, text: "Dạ em cảm ơn anh Minh nhiều" }
    ]
  },
  // 8/10
  {
    where: CHUNG, date: "2026-10-08", time: "09:40",
    lines: [
      {
        by: "acc1",
        text: "14h chiều nay có buổi gọi video với khách Nhật mới ở phòng họp lớn. Khu gần phòng họp mọi người giữ yên lặng giúp em khoảng 1 tiếng nha 🙏",
        react: { "👍": ["linh", "khoa", "nv06"], "👀": ["nv03"] }
      },
      { by: "nv03", gap: 4, text: "Khách Nhật khó tính lắm hả @{acc1}?" },
      { by: "acc1", gap: 3, text: "Kỹ về viền cắt lắm, phóng to 400% để soi luôn 😅 Đợt thử nghiệm chỉ giao cho nhóm anh Khoa chọn thôi." },
      { by: "khoa", gap: 2, text: "Đúng rồi, ai muốn vào nhóm thì luyện thêm cắt tóc với viền vải mỏng nhé, tuần sau mình test." },
      {
        by: "nv06", gap: 3,
        text: "Em đăng ký test nha anh Khoa",
        react: { "🔥": ["khoa"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-10-08", time: "15:30",
    lines: [
      {
        by: "admin",
        text: "Thông báo từ toà nhà: từ 12/10 tầng hầm 2 sơn lại vạch, xe máy tạm gửi tầng hầm 1 và bãi bên hông trong 1 tuần nha.",
        thread: [
          { by: "nv15", gap: 5, text: "Ca chiều về muộn thì bãi hông có bảo vệ không ạ?" },
          { by: "admin", gap: 3, text: "Có bảo vệ 24/7 em nhé, mình đã hỏi kỹ rồi." },
          { by: "nv02", gap: 4, text: "Bãi hông có mái che không ạ, mùa mưa 😢" },
          { by: "admin", gap: 2, text: "Có một nửa thôi, ai đến sớm thì chọn chỗ có mái nha 😅" }
        ]
      },
      {
        by: "nv08", gap: 14,
        text: "Đến sớm để giành chỗ có mái, tự nhiên có động lực đi làm sớm 😂",
        react: { "😂": ["nv02", "admin", "nv15"] }
      }
    ]
  },
  // 9/10 — bản xem trước website
  {
    where: CHUNG, date: "2026-10-09", time: "09:05",
    lines: [
      {
        by: "an",
        text: "Website mới bản xem trước nè cả nhà: [nesso.example/preview](https://nesso.example/preview) — mọi người xem trên điện thoại giúp em, thấy lỗi chữ hay ảnh vỡ thì reply trong thread này nha 🙏",
        react: { "🔥": ["nv02", "nv05", "linh", "minh"], "👀": ["boss", "acc1", "khoa"] },
        thread: [
          {
            by: "nv05", gap: 12,
            text: "Trang before/after kéo thanh trượt trên điện thoại iOS hơi giật nè An",
            files: [{ name: "loi-thanh-truot-preview.png", hint: "ảnh chụp màn hình điện thoại, thanh trượt before/after bị lệch" }]
          },
          { by: "minh", gap: 4, text: "Ghi nhận, anh fix trong hôm nay." },
          { by: "acc1", gap: 9, text: "Mục quy trình đặt đơn nên thêm bước gửi ảnh mẫu, khách hay hỏi chỗ đó" },
          { by: "an", gap: 3, text: "Dạ em thêm ạ 👍" },
          { by: "nv09", gap: 15, text: "Ảnh trang chủ đẹp xỉu, ảnh của đơn nào vậy An?" },
          { by: "an", gap: 4, text: "Ảnh mẫu tự chụp ở văn phòng rồi tụi mình retouch đó, không dùng ảnh khách nha 😉" }
        ]
      },
      { by: "linh", gap: 8, text: "@{boss} anh xem giúp phần **Giới thiệu công ty** trước 17h nay nhé, mai An chốt nội dung." },
      {
        by: "boss", gap: 6,
        text: "Anh xem trên đường đi, trưa anh góp ý trong group website.",
        react: { "👍": ["linh", "an"] }
      },
      { by: "nv14", gap: 7, text: "Trang tuyển dụng có form ứng tuyển luôn hả, xịn quá" },
      { by: "an", gap: 2, text: "Có luôn, nối thẳng về bên hành chính 😎" }
    ]
  },
  {
    where: CHUNG, date: "2026-10-09", time: "16:45",
    lines: [
      {
        by: "nv11",
        text: "Em xin nghỉ phép thứ 2 (12/10) về quê có việc gia đình ạ. Đơn đã gửi @{lead2}, job khách Úc em bàn giao cho @{nv12}.",
        thread: [
          { by: "lead2", gap: 5, text: "Đã duyệt nha. @{nv12} nhận giúp 2 job dở, file hướng dẫn để trong task." },
          {
            by: "nv12", gap: 3,
            text: "Ok, em nhận rồi ạ",
            react: { "👍": ["nv11"] }
          }
        ]
      },
      { by: "nv04", gap: 12, text: "Mọi người ơi khám sức khoẻ 17/10 có phải nhịn ăn sáng không ạ?" },
      {
        by: "admin", gap: 3,
        text: "Có nha, nhịn ăn từ 22h tối hôm trước để xét nghiệm máu. Chi tiết mình ghim ở #thong-bao.",
        react: { "🙏": ["nv04", "nv06"], "😮": ["nv03"] }
      },
      {
        by: "nv03", gap: 2,
        text: "Nhịn ăn sáng thứ 7 là cực hình với em 😭",
        react: { "😂": ["nv04", "admin", "an"] }
      },
      { by: "khoa", gap: 9, text: "@{boss} hôm khám sức khoẻ QC vẫn cần 2 người trực sáng thứ 7 cho đơn Úc, em xếp QC khám đợt 9h–10h được không anh?" },
      { by: "admin", gap: 4, text: "Khung giờ đó phòng khám nhận được nha anh Khoa, chờ anh duyệt thêm là xong 😁" }
    ]
  },
  // 10/10 (thứ 7, hôm nay)
  {
    where: CHUNG, date: "2026-10-10", time: "08:15",
    lines: [
      { by: "admin", text: "Sáng thứ 7 văn phòng làm tới 12h nha. Ai chưa đăng ký khám sức khoẻ 17/10 thì đăng ký giúp mình trước thứ 3 (13/10)." },
      { by: "nv07", gap: 6, text: "Em đăng ký rồi mà chưa thấy tên trong danh sách ạ" },
      { by: "admin", gap: 3, text: "Mình vừa cập nhật, em tải lại trang nha" },
      { by: "nv07", gap: 2, text: "Dạ có rồi ạ 👍" },
      {
        by: "acc2", gap: 15,
        text: "Sáng nay khách Úc gửi 3 đơn gấp, account trực tới 15h nha mọi người",
        react: { "👍": ["lead1", "lead2", "nv05"] }
      }
    ]
  },
  {
    where: CHUNG, date: "2026-10-10", time: "11:40",
    lines: [
      { by: "admin", text: "Có thùng hàng gửi phòng IT ở quầy lễ tân, người nhận là @{minh}. Nặng lắm nha 😅" },
      { by: "minh", gap: 2, text: "Màn hình chuẩn màu cho QC đó, anh xuống liền. Ai rảnh phụ anh khiêng với 🙏" },
      { by: "nv13", gap: 1, text: "Em xuống phụ anh" },
      {
        by: "khoa", gap: 6,
        text: "Cuối cùng cũng về 🙌 tuần sau QC cân màu lại toàn bộ luôn",
        react: { "🔥": ["minh", "nv13"] }
      },
      {
        by: "boss", gap: 5,
        text: "Tốt. @{minh} lắp xong gửi anh ảnh nhé.",
        react: { "👍": ["minh", "khoa"] }
      }
    ]
  },
  // 10/10 chiều — bàn chuyện 20/10
  {
    where: CHUNG, date: "2026-10-10", time: "16:25",
    lines: [
      {
        by: "nv02",
        text: "Mọi người đọc thông báo 20/10 chưa, năm nay được vote chọn hoạt động nè 😍",
        react: { "👀": ["nv05", "nv01"] }
      },
      { by: "nv01", gap: 3, text: "Em vote ăn buffet trưa 🙋" },
      {
        by: "nv05", gap: 2,
        text: "Workshop cắm hoa vui hơn đó, chụp hình sống ảo được nữa 📸",
        react: { "❤️": ["nv02", "an"] }
      },
      { by: "an", gap: 4, text: "Nếu làm workshop thì em lo backdrop chụp hình cho" },
      { by: "nv10", gap: 6, text: "Anh em sản xuất đang chuẩn bị tiết mục văn nghệ bất ngờ cho chị em, mọi người giữ bí mật giùm nha 🤫", deleted: true },
      {
        by: "nv03", gap: 2,
        text: "Ủa nói ở kênh chung là hết bí mật rồi còn gì 😂",
        react: { "😂": ["nv02", "nv05", "nv09", "an", "admin"] }
      },
      { by: "nv10", gap: 1, text: "Thôi xong 🙈 xoá rồi mà chắc ai cũng đọc hết rồi" },
      {
        by: "lead2", gap: 8,
        text: "@{boss} ca B ngày 20/10 trùng đợt đơn Úc, cho ca B tổ chức riêng chiều 19/10 được không anh?",
        react: { "👍": ["nv06", "nv11", "nv14"] }
      },
      { by: "nv14", gap: 4, text: "Còn ca đêm thì sao ạ, tụi em cũng muốn tham gia 🥲" },
      {
        by: "linh", gap: 3,
        text: "Chị đang tính cho ca đêm một buổi tối 20/10 riêng, chờ @{boss} chốt ngân sách nhé.",
        react: { "🙏": ["nv14", "nv15"] }
      },
      { by: "acc1", gap: 6, text: "@{boss} hôm 20/10 khách Nhật gửi đợt thử nghiệm đầu, account xin giữ 1 người trực trong giờ workshop nha anh." },
      {
        by: "nv12", gap: 40,
        text: "Tối nay ca chiều ai đặt trà sữa không, em gom đơn tới 18h nha",
        react: { "👀": ["nv13", "nv14"], "👍": ["nv15"] },
        thread: [
          { by: "nv15", gap: 3, text: "Cho em 1 ly trân châu đường đen ít đá" },
          { by: "nv13", gap: 4, text: "Em nữa, matcha 50% đường" },
          { by: "nv14", gap: 6, text: "Thêm 1 trà đào cho em nha" },
          {
            by: "nv12", gap: 9,
            text: "Chốt đơn 6 ly nha 🧋",
            edited: "Chốt đơn 7 ly nha 🧋 (thêm 1 ly cho @{lead2})"
          }
        ]
      },
      { by: "khoa", gap: 28, text: "Ai về sau cùng nhớ khoá tủ phòng QC giúp anh, màn hình mới đang để trong đó." }
    ]
  }
];

// #thong-bao ------------------------------------------------------------------------------------------
// Top-level posts by boss / linh / admin / minh; others answer in threads and react. nv15 is read-only here.

const thongBao: ChatScene[] = [
  // 25/8 — ra mắt Nesso Work
  {
    where: TB, date: "2026-08-25", time: "08:00",
    lines: [
      {
        by: "boss",
        text: L(
          "## Chính thức dùng Nesso Work từ hôm nay (25/8)",
          "",
          "Chào cả nhà, từ hôm nay công ty chuyển toàn bộ trao đổi công việc và theo dõi đơn hàng sang **Nesso Work**, thay cho các nhóm Zalo và file Excel theo dõi đơn.",
          "",
          "Trong tuần này mỗi người làm giúp anh các bước sau:",
          "[ ] Đăng nhập lần đầu và đổi mật khẩu",
          "[ ] Cập nhật ảnh đại diện + tên hiển thị (Tên - Bộ phận/Ca)",
          "[ ] Vào các kênh #chung, #thong-bao và kênh của bộ phận mình",
          "[ ] Bật thông báo trên điện thoại",
          "[ ] Mở **Việc của tôi** để xem task được giao",
          "[ ] Gửi thử 1 tin nhắn chào trong #chung",
          "",
          "Quy ước: việc cần làm → tạo task; trao đổi nhanh → nhắn trong kênh; thông báo chính thức → chỉ đăng ở #thong-bao. Vướng chỗ nào hỏi anh Minh hoặc chị Linh nhé."
        ),
        react: {
          "🎉": ["linh", "admin", "minh", "an", "khoa", "lead1"],
          "👍": ["lead2", "acc1", "acc2", "nv01", "nv02", "nv15"],
          "❤️": ["hanh", "nv09", "loc"]
        },
        thread: [
          { by: "linh", gap: 4, text: "Dạ em nhận. Chiều nay em hướng dẫn nhanh 15 phút cho từng ca ở phòng họp lớn nhé." },
          { by: "lead1", gap: 3, text: "Ca A xuống lúc 14h, ca B học đợt 16h nha chị, mình báo các bạn rồi." },
          { by: "nv01", gap: 6, text: "Trên điện thoại có app riêng không anh, hay dùng trình duyệt ạ?" },
          { by: "minh", gap: 3, text: "Dùng trình duyệt rồi chọn **Thêm vào màn hình chính** là như app luôn nha, lát anh gửi hướng dẫn có hình." },
          {
            by: "nv06", gap: 20,
            text: "Em làm xong hết checklist rồi ạ ✅",
            react: { "👏": ["boss"] }
          },
          { by: "boss", gap: 4, text: "Nhanh đấy, tốt lắm 👍" }
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-08-25", time: "10:30",
    lines: [
      {
        by: "minh",
        text: "Hướng dẫn dùng Nesso Work trên điện thoại (3 bước, có hình) 📱",
        files: [{ name: "Huong-dan-Nesso-Work-tren-dien-thoai.pdf", hint: "hướng dẫn 3 bước thêm Nesso Work vào màn hình chính điện thoại, có ảnh chụp từng bước" }],
        react: { "🙏": ["nv01", "nv03", "nv11", "acc2"], "👍": ["boss", "linh"] },
        thread: [
          { by: "nv11", gap: 15, text: "Điện thoại Android làm giống vậy luôn hả anh?" },
          { by: "minh", gap: 4, text: "Android thì bấm dấu 3 chấm trên trình duyệt → Thêm vào màn hình chính, xem trang 3 trong file nha." }
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-08-25", time: "16:30",
    lines: [
      {
        by: "linh",
        text: L(
          "Quy ước dùng các kênh chat để mọi người dễ theo dõi:",
          "- #thong-bao: thông báo chính thức của công ty, mọi người trả lời trong thread",
          "- #chung: việc chung của văn phòng, hỏi đáp, nhắc việc",
          "- #san-xuat: ca làm, đơn hàng, deadline",
          "- #qc-chat-luong: lỗi thường gặp, hướng dẫn style",
          "- #it-ho-tro: báo lỗi máy, NAS, phần mềm",
          "- #tan-gau: chuyện ngoài lề, ăn uống, đá bóng 😄",
          "",
          "Lưu ý: **không gửi ảnh của khách** vào #chung và #tan-gau."
        ),
        react: { "👍": ["boss", "admin", "khoa", "nv03", "nv10"], "✅": ["lead1", "lead2", "acc1"] },
        thread: [
          { by: "nv14", gap: 10, text: "Ảnh khách thì gửi trong #san-xuat được không chị?" },
          { by: "linh", gap: 4, text: "Được em, trong #san-xuat, #qc-chat-luong và trong task thôi, vì chỉ người làm sản xuất xem được." }
        ]
      }
    ]
  },
  // 26/8
  {
    where: TB, date: "2026-08-26", time: "09:00",
    lines: [
      {
        by: "admin",
        text: "Nhắc cả nhà hoàn thành checklist Nesso Work trước thứ 6 (28/8) nha. Hiện còn khoảng 9 bạn chưa có ảnh đại diện, nhìn danh sách toàn chữ cái xám xám 😁",
        react: { "😂": ["an", "nv03", "minh", "nv07"], "👍": ["linh", "boss"] },
        thread: [
          { by: "nv13", gap: 25, text: "Em đổi ảnh rồi mà vẫn chưa thấy cập nhật ạ" },
          { by: "minh", gap: 5, text: "Em đăng xuất rồi vào lại là thấy nha." },
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-08-26", time: "15:00",
    lines: [
      {
        by: "admin",
        text: L(
          "Nhắc lại giờ làm việc chính thức:",
          "- Khối văn phòng: thứ 2 – thứ 6 8h00–17h30, **thứ 7 8h00–12h00**",
          "- Ca sáng: 7h30–16h00",
          "- Ca chiều: 13h30–22h00",
          "- Ca đêm (khi có đơn gấp): 22h00–6h00, đăng ký với trưởng ca",
          "",
          "Chấm công bằng vân tay ở cổng chính, quên chấm thì báo trưởng ca xác nhận trong ngày nha."
        ),
        react: { "👍": ["nv02", "nv05", "acc2", "lead2", "nv15"] },
        thread: [
          { by: "nv09", gap: 12, text: "Ca chiều thứ 7 có cơm tối không ạ?" },
          { by: "admin", gap: 6, text: "Chưa có em, cơm tối chỉ áp dụng khi tăng ca sau 19h thôi nha." }
        ]
      }
    ]
  },
  // 27/8 — lịch nghỉ lễ 2/9
  {
    where: TB, date: "2026-08-27", time: "10:00",
    lines: [
      {
        by: "admin",
        text: L(
          "## Lịch nghỉ lễ Quốc khánh 2/9",
          "- Khối văn phòng nghỉ **thứ 3 (1/9) và thứ 4 (2/9)**, đi làm lại thứ 4 (3/9).",
          "- Sản xuất duy trì **ca trực** cho đơn Úc/Mỹ, danh sách trưởng ca chốt trước 29/8.",
          "- Ca trực ngày lễ được tính lương theo quy định của luật lao động + phụ cấp ăn trưa.",
          "- Ai muốn đăng ký trực thì báo trưởng ca trước thứ 7 (29/8).",
          "",
          "Chúc mọi người kỳ nghỉ vui vẻ, đi đường an toàn 🇻🇳"
        ),
        edited: L(
          "## Lịch nghỉ lễ Quốc khánh 2/9",
          "- Khối văn phòng nghỉ **thứ 3 (1/9) và thứ 4 (2/9)**, đi làm lại **thứ 5 (3/9)**.",
          "- Sản xuất duy trì **ca trực** cho đơn Úc/Mỹ, danh sách trưởng ca chốt trước 29/8.",
          "- Ca trực ngày lễ được tính lương theo quy định của luật lao động + phụ cấp ăn trưa.",
          "- Ai muốn đăng ký trực thì báo trưởng ca trước thứ 7 (29/8).",
          "",
          "Chúc mọi người kỳ nghỉ vui vẻ, đi đường an toàn 🇻🇳"
        ),
        react: { "🎉": ["nv01", "nv03", "nv07", "nv12", "an", "hanh"], "👍": ["boss", "linh", "nv15"] },
        thread: [
          { by: "nv08", gap: 15, text: "Em đăng ký trực ngày 1/9 ạ" },
          { by: "lead1", gap: 6, text: "Ghi nhận nha, tối nay mình tổng hợp gửi chị Linh" },
          { by: "nv10", gap: 20, text: "Ca trực có cần lên văn phòng không hay làm từ xa được ạ?" },
          { by: "linh", gap: 5, text: "Lên văn phòng em nhé, file khách chỉ được làm trên máy công ty theo quy định bảo mật." }
        ]
      }
    ]
  },
  // 28/8 — nội quy bảo mật
  {
    where: TB, date: "2026-08-28", time: "09:15",
    lines: [
      {
        by: "boss",
        text: L(
          "## Nội quy bảo mật dữ liệu khách hàng (áp dụng từ 1/9)",
          "Ảnh và thông tin của khách là tài sản quan trọng nhất của công ty. Mọi người tuân thủ giúp anh:",
          "1. Không chụp màn hình, chụp ảnh file khách để gửi qua Zalo, Facebook hay bất kỳ kênh cá nhân nào.",
          "2. Không cắm USB, ổ cứng cá nhân vào máy sản xuất. Cần chép file thì nhờ IT.",
          "3. Không dùng ảnh khách làm portfolio cá nhân, kể cả ảnh đã chỉnh.",
          "4. Không nhắc tên khách, mã đơn ở #chung, #tan-gau hay mạng xã hội.",
          "5. Rời chỗ ngồi thì khoá màn hình (phím Windows + L).",
          "6. Mọi người ký lại cam kết bảo mật với hành chính trước 5/9.",
          "",
          "Vi phạm sẽ xử lý theo nội quy lao động. Có câu hỏi thì trả lời trong thread này nhé."
        ),
        react: {
          "👍": ["linh", "admin", "lead1", "lead2", "acc1", "acc2"],
          "✅": ["nv02", "nv04", "nv11", "nv14", "nv15", "loc"],
          "💯": ["khoa", "minh"]
        },
        thread: [
          { by: "nv02", gap: 12, text: "Ảnh before/after mình tự chụp ngoài giờ để luyện tay thì đăng được không anh?" },
          { by: "boss", gap: 8, text: "Ảnh tự chụp thì thoải mái em, chỉ cấm ảnh của khách thôi." },
          { by: "khoa", gap: 5, text: "Bổ sung: bài test cho ứng viên cũng chỉ dùng bộ ảnh mẫu của công ty, không lấy ảnh đơn thật." },
          { by: "admin", gap: 4, text: "Mẫu cam kết mình để ở quầy, mọi người ghé ký giúp mình nha." },
          { by: "nv11", gap: 3, text: "Dạ em nhận ạ" }
        ]
      }
    ]
  },
  // 29/8 (thứ 7)
  {
    where: TB, date: "2026-08-29", time: "09:00",
    lines: [
      {
        by: "admin",
        text: "Nhắc: mọi người kiểm tra **bảng chấm công tháng 8** và phản hồi trước 17h thứ 2 (31/8). Tháng này còn ghép công từ máy chấm vân tay cũ nên có thể lệch vài ngày, ai thấy sai báo mình sớm nha 🙏",
        react: { "👀": ["nv03", "nv08", "nv12"], "👍": ["lead1", "lead2"] },
        thread: [
          { by: "nv03", gap: 30, text: "Ngày 20/8 em đi chụp ảnh mẫu cùng An mà bảng ghi vắng ạ" },
          { by: "admin", gap: 5, text: "Ok em, mình đối chiếu với An rồi sửa nha." },
          { by: "an", gap: 8, text: "Đúng ạ, hôm đó bạn ấy đi chụp ảnh mẫu với em cả ngày." }
        ]
      }
    ]
  },
  // 31/8 — ca trực lễ
  {
    where: TB, date: "2026-08-31", time: "15:00",
    lines: [
      {
        by: "linh",
        text: L(
          "Danh sách ca trực lễ 1–2/9:",
          "- **1/9**: trưởng ca @{lead1}, @{nv05}, @{nv08} (7h30–16h)",
          "- **2/9**: trưởng ca @{lead1}, @{nv05}, @{nv11} (7h30–16h)",
          "- Account trực online: @{acc1} (theo dõi email khách)",
          "- QC kiểm tra online lúc 15h mỗi ngày: @{khoa}",
          "",
          "Cuối ca nhớ chụp màn hình tiến độ gửi #san-xuat nhé. Cảm ơn các em 🙏"
        ),
        react: { "🙏": ["boss", "admin"], "👍": ["lead1", "nv05", "nv08", "nv11"] },
        thread: [
          { by: "acc1", gap: 4, text: "Em nhận, có đơn mới em báo trong #san-xuat ngay" },
          { by: "khoa", gap: 9, text: "Ok chị, 15h mỗi ngày anh check." },
          { by: "boss", gap: 15, text: "Cảm ơn ca trực. Có gì gấp gọi anh." }
        ]
      }
    ]
  },
  // 3/9 — BHXH
  {
    where: TB, date: "2026-09-03", time: "10:00",
    lines: [
      {
        by: "admin",
        text: L(
          "## Lịch BHXH tháng 9",
          "- Công ty đóng BHXH, BHYT, BHTN tháng 9 trước ngày **25/9**.",
          "- Bạn nào vào làm từ tháng 8 nộp tờ khai tham gia BHXH + bản photo giấy tờ tùy thân cho hành chính trước **10/9**.",
          "- Ai muốn đổi nơi khám chữa bệnh ban đầu cho năm 2027 thì đăng ký trước **30/10**.",
          "- Mọi người tra cứu quá trình đóng trên ứng dụng BHXH số của nhà nước nha."
        ),
        react: { "👍": ["linh", "nv14", "nv13", "acc2"], "🙏": ["nv06"] },
        thread: [
          { by: "nv14", gap: 20, text: "Em vào làm từ giữa tháng 8 thì tháng 8 có được đóng không ạ?" },
          { by: "admin", gap: 6, text: "Có em, mình đã báo tăng từ tháng 8 rồi, em nộp bổ sung giấy tờ sớm giúp mình nha." },
        ]
      }
    ]
  },
  // 4/9 — sinh nhật tháng 9
  {
    where: TB, date: "2026-09-04", time: "09:30",
    lines: [
      {
        by: "admin",
        text: L(
          "🎂 **Sinh nhật tháng 9**",
          "- 9/9: @{nv04}",
          "- 17/9: @{nv13}",
          "- 23/9: chị @{linh}",
          "",
          "Công ty tặng mỗi bạn một phần quà nhỏ, thổi nến chung chiều thứ 6 (25/9) cùng tiệc Trung thu nha 🎉"
        ),
        react: { "🎉": ["boss", "an", "nv02", "nv09", "acc2", "hanh"], "❤️": ["nv04", "nv13", "linh"] },
        thread: [
          { by: "nv13", gap: 8, text: "Ơ có em nữa hả, cảm ơn công ty ạ 🥹" },
          { by: "linh", gap: 10, text: "Cảm ơn em đã nhớ nha 😄" }
        ]
      }
    ]
  },
  // 7/9 — team building
  {
    where: TB, date: "2026-09-07", time: "08:30",
    lines: [
      {
        by: "admin",
        text: L(
          "## Team building tháng 9: Vũng Tàu 26–27/9 🏖️",
          "- Thời gian: sáng thứ 7 (26/9) → chiều CN (27/9)",
          "- Đối tượng: toàn thể nhân viên; sản xuất chia ca trực luân phiên vì đơn Úc vẫn chạy",
          "- Đăng ký trước **15/9** trong kênh #team-building-thang-9",
          "- Được đi kèm 1 người thân (chi phí người thân hành chính thông báo sau)",
          "- Ban tổ chức: @{admin}, @{nv02}, @{nv09}, An và chị Linh",
          "",
          "Mọi người tham gia đông đủ nha!"
        ),
        react: {
          "🎉": ["nv01", "nv03", "nv05", "nv07", "nv12", "hanh"],
          "🔥": ["nv02", "nv09", "an", "loc"],
          "❤️": ["boss", "linh", "nv15"]
        },
        thread: [
          { by: "nv07", gap: 10, text: "Ai trực không đi được thì có được bù không ạ?" },
          { by: "linh", gap: 5, text: "Có em, các bạn trực được nghỉ bù 1 ngày và có phần quà riêng." },
          { by: "boss", gap: 20, text: "Năm nay anh đi cùng cả 2 ngày. Mọi người đăng ký sớm cho ban tổ chức dễ đặt phòng." },
          { by: "nv02", gap: 2, text: "Dạ sếp 🎉" }
        ]
      }
    ]
  },
  // 9/9 — chia tay Lộc
  {
    where: TB, date: "2026-09-09", time: "14:00",
    lines: [
      {
        by: "linh",
        text: "Lộc (ca B) sẽ nghỉ việc từ **12/9** để chuyển ra Bắc sinh sống. Chiều thứ 6 (11/9) lúc 17h mình có buổi chia tay nhỏ ở phòng ăn lầu 1, mọi người sắp xếp ghé nhé. Việc của Lộc đã bàn giao cho @{nv06} và @{nv10}.",
        react: { "😢": ["nv03", "nv06", "nv01", "an"], "❤️": ["loc", "boss", "khoa"] },
        thread: [
          { by: "loc", gap: 5, text: "Em cảm ơn chị Linh và mọi người ạ 🙏" },
          { by: "nv06", gap: 8, text: "Em nhận bàn giao rồi ạ, có gì em hỏi Lộc trước thứ 6" },
          { by: "admin", gap: 12, text: "Mình chuẩn bị bánh và quà lưu niệm, ai muốn viết lời chúc thì ghé quầy ký thiệp nha." }
        ]
      }
    ]
  },
  // 10/9 — chuẩn bị tuần cao điểm
  {
    where: TB, date: "2026-09-10", time: "17:00",
    lines: [
      {
        by: "boss",
        text: L(
          "## Tuần cao điểm 14–19/9",
          "Mùa xuân bên Úc, các agency bất động sản đẩy đơn rất nhiều. Dự kiến lượng ảnh gần gấp đôi tuần thường.",
          "- Sản xuất mở thêm **ca đêm** 22h–6h từ 14/9, đăng ký với trưởng ca.",
          "- Ca sáng/chiều tăng ca tối đa 2 giờ/ngày, có cơm tối.",
          "- QC trực xuyên ca, ưu tiên đơn có hạn trong 12 giờ.",
          "- Account ghi hạn chính xác theo giờ Úc trong từng task.",
          "",
          "Chất lượng vẫn là số 1, không đánh đổi chất lượng để kịp hạn. Cảm ơn mọi người trước 🙏"
        ),
        react: {
          "💯": ["khoa", "linh"],
          "🔥": ["lead1", "lead2", "nv05", "nv10"],
          "👍": ["acc1", "acc2", "nv01", "nv08", "nv15"]
        },
        thread: [
          { by: "lead2", gap: 15, text: "Ca B đăng ký ca đêm được 4 bạn rồi anh" },
          { by: "nv10", gap: 10, text: "Ca đêm có được nghỉ bù sáng hôm sau không anh?" },
          { by: "linh", gap: 4, text: "Có em, làm ca đêm xong nghỉ tới 13h30 hôm sau, trưởng ca sắp xếp." },
          { by: "boss", gap: 9, text: "Tốt. Cố lên cả nhà 💪" }
        ]
      }
    ]
  },
  // 15/9 — lịch bảo trì NAS
  {
    where: TB, date: "2026-09-15", time: "10:00",
    lines: [
      {
        by: "minh",
        text: L(
          "## Lịch bảo trì và chuyển NAS",
          "- **18h thứ 7 (19/9) → 12h CN (20/9)**: chuyển dữ liệu từ NAS cũ sang NAS mới. Trong thời gian này NAS chỉ đọc, không ghi được.",
          "- Ca đêm 19/9 làm trên ổ máy, sáng 20/9 đẩy lên NAS mới.",
          "- Thứ 2 (21/9) mọi người map lại ổ `N:` theo hướng dẫn mình gửi (khoảng 1 phút).",
          "- Lỗi phát sinh báo ở #it-ho-tro kèm ảnh chụp.",
          "",
          "Cảm ơn mọi người đã chịu khó 🙏"
        ),
        edited: L(
          "## Lịch bảo trì và chuyển NAS",
          "- **18h thứ 7 (19/9) → 12h CN (20/9)**: chuyển dữ liệu từ NAS cũ sang NAS mới. Trong thời gian này NAS chỉ đọc, không ghi được.",
          "- Ca đêm 19/9 làm trên ổ máy, sáng 20/9 đẩy lên NAS mới.",
          "- Thứ 2 (21/9) mọi người map lại ổ `N:` theo hướng dẫn mình gửi (khoảng 1 phút).",
          "- NAS cũ giữ nguyên ở chế độ chỉ đọc thêm 2 tuần để dự phòng.",
          "- Lỗi phát sinh báo ở #it-ho-tro kèm ảnh chụp.",
          "",
          "Cảm ơn mọi người đã chịu khó 🙏"
        ),
        react: { "👀": ["lead1", "lead2", "nv04", "nv10"], "👍": ["linh", "khoa", "acc1"], "🙏": ["boss"] },
        thread: [
          { by: "lead1", gap: 12, text: "Thứ 7 đó vẫn còn cao điểm, có lùi sang tuần sau được không anh Minh?" },
          { by: "minh", gap: 6, text: "Anh cân nhắc rồi, NAS cũ gần đầy, để thêm 1 tuần sợ không đủ chỗ cho đơn mới. Ca đêm làm trên ổ máy vẫn ổn nha." },
          { by: "boss", gap: 10, text: "Đồng ý giữ lịch. @{minh} chuẩn bị phương án quay lại NAS cũ nếu có sự cố nhé." },
          { by: "minh", gap: 3, text: "Dạ có rồi anh, NAS cũ giữ nguyên 2 tuần để dự phòng." },
        ]
      }
    ]
  },
  // 17/9 — chốt danh sách team building
  {
    where: TB, date: "2026-09-17", time: "09:00",
    lines: [
      {
        by: "admin",
        text: "Chốt danh sách team building: **38 người** đi + 6 người thân. Ai thay đổi báo mình trước 18h thứ 6 (18/9) để đặt phòng, sau giờ đó không đổi được nữa nha 🙏",
        react: { "👍": ["linh", "nv02", "nv09"], "✅": ["an", "boss"] },
        thread: [
          { by: "nv14", gap: 18, text: "Em đổi từ đi 2 ngày sang chỉ đi ngày 26 được không ạ?" },
          { by: "admin", gap: 5, text: "Được em, mình cập nhật rồi nha." }
        ]
      }
    ]
  },
  // 18/9 — Trung thu
  {
    where: TB, date: "2026-09-18", time: "10:30",
    lines: [
      {
        by: "admin",
        text: L(
          "## Tết Trung thu 25/9 🥮",
          "- Công ty tặng mỗi người **1 hộp bánh trung thu**, phát chiều thứ 6 (25/9).",
          "- 16h30: tiệc nhỏ ở sảnh lầu 1, có trà, bánh, lồng đèn + thổi nến sinh nhật tháng 9.",
          "- Ca chiều/ca đêm xuống theo đợt, trưởng ca sắp xếp.",
          "",
          "Ai ăn chay hoặc không ăn được trứng muối báo mình trước 22/9 nha."
        ),
        react: { "❤️": ["nv01", "nv05", "nv09", "hanh", "nv15"], "🎉": ["an", "nv03", "nv07"] },
        thread: [
          { by: "nv12", gap: 6, text: "Em ăn chay ạ" },
          { by: "nv14", gap: 2, text: "Em cũng chay ạ 🙏" },
          { by: "admin", gap: 5, text: "Ghi nhận 2 phần chay nha." },
        ]
      }
    ]
  },
  // 21/9 — NAS mới
  {
    where: TB, date: "2026-09-21", time: "09:30",
    lines: [
      {
        by: "minh",
        text: L(
          "NAS mới đã chạy ổn định từ 11h hôm qua ✅ Dữ liệu đã chuyển xong 100% và kiểm tra đủ.",
          "- Sáng nay một số nhóm bị lỗi quyền truy cập, mình xử lý theo thứ tự ca A → ca B → văn phòng.",
          "- Hướng dẫn map ổ: [xem tại đây](https://nesso.example/it/map-o-nas-moi)",
          "- NAS cũ để chế độ chỉ đọc đến 4/10."
        ),
        react: { "👍": ["lead1", "nv04", "nv02"], "🙏": ["linh", "acc1"], "👏": ["boss"] },
        thread: [
          { by: "nv06", gap: 10, text: "Ca B vẫn chưa vào được thư mục đơn Úc ạ" },
          { by: "minh", gap: 5, text: "Đang làm ca B nha, khoảng 10h xong." },
          { by: "nv06", gap: 35, text: "Vào được rồi ạ, cảm ơn anh 👍" },
        ]
      }
    ]
  },
  // 22/9 — lịch trình team building
  {
    where: TB, date: "2026-09-22", time: "14:00",
    lines: [
      {
        by: "admin",
        text: L(
          "## Lịch trình team building 26–27/9",
          "**Thứ 7 (26/9)**",
          "- 5h45: tập trung trước cổng công ty, 6h xe chạy",
          "- 9h30: nhận phòng, tắm biển tự do",
          "- 15h: hoạt động team building trên bãi biển",
          "- 19h: gala dinner + bốc thăm quà",
          "",
          "**CN (27/9)**",
          "- Sáng: tự do, ăn sáng, trả phòng 11h",
          "- 14h: xe về, dự kiến 17h tới công ty",
          "",
          "Mang theo: giấy tờ tùy thân, đồ bơi, kem chống nắng, áo đồng phục (phát ngày 24/9)."
        ),
        files: [{ name: "Lich-trinh-team-building-Vung-Tau.pdf", hint: "lịch trình 2 ngày Vũng Tàu, bảng giờ và sơ đồ chia phòng" }],
        react: { "🎉": ["nv01", "nv05", "nv12", "nv13"], "🔥": ["nv02", "nv09", "an"], "❤️": ["boss", "hanh", "nv15"] },
        thread: [
          { by: "nv03", gap: 15, text: "Áo đồng phục size thế nào ạ, em đăng ký L mà sợ chật" },
          { by: "admin", gap: 4, text: "Bảng size có trong file nha, cần đổi thì báo @{nv02}." },
          { by: "nv02", gap: 3, text: "Đổi size nhắn mình trước 23/9 nha mọi người" },
        ]
      }
    ]
  },
  // 24/9 — chấm công tháng 9
  {
    where: TB, date: "2026-09-24", time: "09:00",
    lines: [
      {
        by: "admin",
        text: "Bảng chấm công tháng 9 đã có trong task của từng người. Kiểm tra và phản hồi trước **17h ngày 30/9** nha. Lưu ý: các bạn trực sản xuất trong 2 ngày team building được tính công trực riêng.",
        react: { "👀": ["nv08", "nv10"], "👍": ["lead1", "lead2", "nv15"] },
        thread: [
          { by: "nv08", gap: 40, text: "Ngày 1/9 em trực lễ mà bảng ghi nghỉ ạ" },
          { by: "admin", gap: 10, text: "Mình sửa rồi nha, cảm ơn em đã báo." }
        ]
      }
    ]
  },
  // 25/9 — cảm ơn sau tuần cao điểm
  {
    where: TB, date: "2026-09-25", time: "18:00",
    lines: [
      {
        by: "boss",
        text: L(
          "Cảm ơn cả nhà sau tuần cao điểm 14–19/9: mình giao **100% đơn đúng hạn**, tỉ lệ ảnh khách yêu cầu sửa lại chỉ **2,9%** dù lượng ảnh gần gấp đôi. Đặc biệt cảm ơn ca đêm và team QC 👏",
          "",
          "Chúc mọi người Trung thu ấm áp bên gia đình, hẹn gặp ở Vũng Tàu cuối tuần này 🏖️"
        ),
        react: {
          "❤️": ["linh", "admin", "nv05", "nv10", "nv12", "nv15"],
          "👏": ["khoa", "lead1", "lead2", "acc1", "an", "minh"],
          "🎉": ["nv02", "nv09", "hanh"]
        },
        thread: [
          { by: "lead2", gap: 10, text: "Cảm ơn anh, ca đêm đọc được chắc vui lắm ạ" },
          { by: "nv10", gap: 6, text: "Dạ em cảm ơn anh 🥹 mệt mà vui" },
          { by: "khoa", gap: 12, text: "Mấy lỗi trời ám tím tuần rồi QC đã tổng hợp thành bài học, tuần sau chia sẻ ở #qc-chat-luong ạ" }
        ]
      }
    ]
  },
  // 28/9 — sau team building
  {
    where: TB, date: "2026-09-28", time: "09:00",
    lines: [
      {
        by: "admin",
        text: L(
          "Cảm ơn mọi người đã tham gia team building Vũng Tàu 🧡 Chuyến đi an toàn, vui vẻ trọn vẹn.",
          "- Album ảnh: [Vũng Tàu 26–27/9](https://nesso.example/album/team-building-2026)",
          "- Kênh #team-building-thang-9 sẽ được lưu trữ từ hôm nay.",
          "- Đồ thất lạc (1 kính râm, 1 sạc dự phòng trắng) đang ở quầy lễ tân."
        ),
        react: { "❤️": ["boss", "linh", "an", "nv02", "nv09", "nv15"], "🎉": ["nv05", "nv11", "hanh"] },
        thread: [
          { by: "nv05", gap: 8, text: "Sạc dự phòng màu trắng là của em ạ 😅" },
          { by: "admin", gap: 3, text: "Qua quầy lấy nha em." },
          { by: "nv11", gap: 15, text: "Kính râm chắc của em, để em qua xem 😎" }
        ]
      }
    ]
  },
  // 29/9 — Hạnh kết thúc thực tập
  {
    where: TB, date: "2026-09-29", time: "17:00",
    lines: [
      {
        by: "linh",
        text: "Thứ 4 (30/9) là ngày cuối thực tập của Hạnh bên marketing. Cảm ơn Hạnh 3 tháng qua đã đóng góp nhiều bài viết fanpage và bộ ảnh portfolio 🌸 Chúc em bảo vệ tốt nghiệp thành công!",
        react: { "❤️": ["an", "boss", "minh", "admin", "nv09", "nv02"], "👏": ["acc1", "acc2", "nv15"] },
        thread: [
          { by: "hanh", gap: 5, text: "Em cảm ơn chị Linh và cả nhà ạ 🥹" },
          { by: "an", gap: 3, text: "Đi đâu cũng nhớ về đây nha Hạnh ❤️" }
        ]
      }
    ]
  },
  // 1/10 — kết quả quý 3
  {
    where: TB, date: "2026-10-01", time: "09:00",
    lines: [
      {
        by: "boss",
        text: L(
          "## Kết quả quý 3/2026",
          "Cảm ơn cả nhà vì một quý rất nỗ lực. Vài con số chính:",
          "- Sản lượng ảnh tăng **24%** so với quý 2",
          "- Năng suất bình quân **~78 ảnh/người/ngày** (quý 2: ~70)",
          "- Tỉ lệ đơn giao đúng hạn: **98,6%**",
          "- Tỉ lệ ảnh khách yêu cầu sửa lại giảm từ **4,1%** xuống **2,7%**",
          "- Thêm **5 khách mới** (Úc, Mỹ, châu Âu), giữ được 100% khách cũ",
          "- Chuyển đổi xong sang Nesso Work và NAS mới",
          "",
          "Cần cải thiện trong quý 4: lỗi màu trời, kéo cửa sổ và thời gian phản hồi khách ngoài giờ. Kickoff Q4 sáng thứ 2 (5/10), anh sẽ chia sẻ kỹ hơn."
        ),
        files: [{ name: "san-luong-Q3-2026.png", hint: "biểu đồ cột sản lượng ảnh theo tháng 7-8-9 và tỉ lệ đúng hạn, không có số tiền" }],
        react: {
          "🎉": ["linh", "admin", "an", "nv01", "nv05", "nv12"],
          "👏": ["khoa", "lead1", "lead2", "acc1", "acc2", "minh"],
          "🔥": ["nv02", "nv07", "nv10", "nv15"],
          "💯": ["nv04"]
        },
        thread: [
          { by: "linh", gap: 8, text: "Cảm ơn anh. Bảng chi tiết theo từng ca em đã gửi vào dự án báo cáo quý ạ." },
          { by: "lead1", gap: 5, text: "Ca A sẽ tập trung giảm lỗi kéo cửa sổ trong Q4 ạ" },
          { by: "acc1", gap: 10, text: "Khách cũ cũng phản hồi tốt về tốc độ trả file quý này ạ" },
          { by: "boss", gap: 15, text: "Cảm ơn cả nhà. Quý 4 mình làm tốt hơn nữa nhé 💪" }
        ]
      }
    ]
  },
  // 2/10 — lịch trả lương
  {
    where: TB, date: "2026-10-02", time: "10:00",
    lines: [
      {
        by: "admin",
        text: "Lương tháng 9 sẽ được chuyển vào **thứ 2 ngày 5/10** (3–4/10 là cuối tuần). Phiếu lương gửi riêng từng người qua tin nhắn riêng trên Nesso Work. Thắc mắc nhắn riêng hành chính trước 9/10 nha.",
        react: { "🎉": ["nv03", "nv05", "nv07"], "👍": ["linh", "acc1"], "🙏": ["nv12", "nv15"] },
        thread: [
          { by: "nv09", gap: 12, text: "Công trực mấy ngày team building có tính trong lương tháng này không ạ?" },
          { by: "admin", gap: 5, text: "Có em, công trực đó tính trong lương tháng 9 nha." },
          { by: "nv09", gap: 2, text: "Dạ em cảm ơn ạ" }
        ]
      }
    ]
  },
  // 3/10 (thứ 7) — lịch kickoff
  {
    where: TB, date: "2026-10-03", time: "09:30",
    lines: [
      {
        by: "linh",
        text: L(
          "**Kickoff quý 4** – thứ 2 (5/10), 8h30–9h30, phòng họp lớn",
          "- Bắt buộc: trưởng ca, QC, account, marketing",
          "- Các bạn sản xuất xem trực tuyến qua link gửi trước giờ họp",
          "- Nội dung: kết quả Q3, mục tiêu Q4, **checklist QC v2**, kế hoạch tuyển dụng, ra mắt website mới",
          "",
          "@{boss} anh xác nhận giờ giúp em nhé."
        ),
        react: { "👍": ["lead1", "lead2", "khoa", "an", "acc1"] },
        thread: [
          { by: "boss", gap: 25, text: "Anh xác nhận. 8h20 anh có mặt." },
          { by: "khoa", gap: 6, text: "Em chuẩn bị 10 phút trình bày checklist QC v2 ạ" }
        ]
      }
    ]
  },
  // 5/10 — lương, checklist QC v2, tuyển dụng
  {
    where: TB, date: "2026-10-05", time: "08:00",
    lines: [
      {
        by: "admin",
        text: "Lương tháng 9 đã được chuyển khoản sáng nay ✅ Phiếu lương mình đã gửi riêng từng người. Thắc mắc nhắn riêng hành chính trước **9/10** nha. Cảm ơn mọi người một tháng vất vả 🙏",
        react: {
          "🎉": ["nv01", "nv02", "nv03", "nv05", "nv10", "nv12"],
          "❤️": ["nv07", "nv09", "nv15"],
          "🙏": ["lead1", "acc2"]
        },
        thread: [
          { by: "nv03", gap: 10, text: "Dạ em nhận rồi ạ 🎉" }
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-10-05", time: "10:00",
    lines: [
      {
        by: "linh",
        text: L(
          "## Checklist QC v2 – áp dụng từ hôm nay (5/10)",
          "Mỗi ảnh trước khi chuyển **Chờ QC** tự kiểm theo checklist:",
          "[ ] Đúng ghi chú của đơn (style, kích thước, định dạng)",
          "[ ] Đường chân trời thẳng, cột dọc thẳng",
          "[ ] Màu trời tự nhiên, không ám tím hay xanh quá",
          "[ ] Cửa sổ kéo rõ cảnh bên ngoài, không viền sáng/halo",
          "[ ] Không còn vật thể cần xoá, không lặp texture",
          "[ ] Viền cắt sạch ở zoom 200% (đơn cut-out)",
          "[ ] Tên file đúng quy ước, đủ số lượng",
          "",
          "Checklist đã gắn sẵn vào mẫu task sản xuất. Chi tiết và ví dụ lỗi xem file của anh Khoa 👇"
        ),
        files: [{ name: "Checklist-QC-v2.pdf", hint: "checklist QC 7 mục, mỗi mục có ảnh ví dụ đúng/sai" }],
        react: {
          "✅": ["khoa", "lead1", "lead2", "nv04", "nv07", "nv15"],
          "👍": ["acc1", "acc2", "nv01", "nv06"],
          "💯": ["boss"]
        },
        thread: [
          { by: "nv04", gap: 15, text: "Đơn virtual staging có cần check thêm bóng đổ đồ nội thất không ạ?" },
          { by: "khoa", gap: 6, text: "Có, đơn staging check thêm bóng đổ và tỉ lệ đồ, anh bổ sung mục riêng trong tuần này." },
          { by: "lead2", gap: 12, text: "Ca B đã in checklist dán tại từng máy rồi ạ" },
          { by: "boss", gap: 10, text: "Rất tốt. Tuần đầu áp dụng QC ghi nhận lỗi theo từng mục checklist để mình có số liệu nhé." },
          { by: "nv07", gap: 5, text: "Dạ em nhận ạ ✅" }
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-10-05", time: "14:00",
    lines: [
      {
        by: "boss",
        text: L(
          "## Tuyển dụng: 6 retoucher (ca sáng/ca chiều)",
          "Quý 4 công ty cần thêm **6 bạn chỉnh ảnh**, ưu tiên có kinh nghiệm HDR bất động sản hoặc cắt nền sản phẩm.",
          "- Giới thiệu người quen: gửi CV cho @{admin}, ghi rõ người giới thiệu.",
          "- Ứng viên qua thử việc → người giới thiệu nhận **thưởng giới thiệu** theo chính sách nhân sự.",
          "- Bài test làm tại văn phòng, QC + trưởng ca chấm.",
          "",
          "Mọi người chia sẻ giúp anh nhé 🙏"
        ),
        react: { "🔥": ["nv10", "nv13", "an", "lead1"], "👍": ["linh", "khoa", "admin", "nv15"], "🙏": ["acc1"] },
        thread: [
          { by: "nv10", gap: 20, text: "Bạn em mới học xong khoá chỉnh ảnh, chưa có kinh nghiệm thì nộp được không anh?" },
          { by: "boss", gap: 12, text: "Được em, bài test ổn thì mình đào tạo thêm. Tháng 11 có lớp đào tạo người mới." },
          { by: "lead1", gap: 9, text: "Ca A xin ưu tiên 2 bạn có kinh nghiệm cut-out cho đơn khách Nhật ạ" }
        ]
      }
    ]
  },
  // 6/10
  {
    where: TB, date: "2026-10-06", time: "09:00",
    lines: [
      {
        by: "admin",
        text: L(
          "🎂 **Sinh nhật tháng 10**",
          "- 6/10: trưởng ca @{lead1} (hôm nay!)",
          "- 14/10: @{nv07}",
          "- 28/10: @{acc2}",
          "",
          "Thổi nến chung chiều thứ 6 (30/10) nha cả nhà 🎉"
        ),
        react: { "🎉": ["boss", "linh", "nv01", "nv04", "an", "nv15"], "❤️": ["lead1", "nv07", "acc2"] },
        thread: [
          { by: "nv07", gap: 10, text: "Ui em cảm ơn ạ 🥰" },
          { by: "lead1", gap: 6, text: "Cảm ơn hành chính nha ❤️" }
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-10-06", time: "14:00",
    lines: [
      {
        by: "minh",
        text: L(
          "## Bảo trì Nesso Work tối thứ 4 (7/10)",
          "- 21h00–21h30: nâng cấp phiên bản mới (thêm tìm kiếm theo người gửi, xem trước file PDF)",
          "- Gián đoạn khoảng 10–15 phút, tin nhắn đang gửi dở có thể phải gửi lại",
          "- Ca chiều/ca đêm cần liên lạc gấp trong lúc đó thì gọi trưởng ca nha"
        ),
        react: { "👍": ["linh", "lead2", "acc1", "nv14"], "👀": ["nv10"] },
        thread: [
          { by: "nv14", gap: 12, text: "Trong lúc bảo trì task có bị mất gì không anh?" },
          { by: "minh", gap: 3, text: "Không mất gì em, sau 21h30 dùng bình thường." },
          { by: "lead2", gap: 4, text: "Ok anh, ca B sẽ cập nhật trạng thái task trước 21h." }
        ]
      }
    ]
  },
  // 7/10 — khám sức khoẻ
  {
    where: TB, date: "2026-10-07", time: "09:30",
    lines: [
      {
        by: "admin",
        text: L(
          "## Khám sức khoẻ định kỳ 2026",
          "- Thời gian: **thứ 7 (17/10)**, 7h–11h tại phòng khám đối tác, cách công ty 5 phút đi bộ",
          "- Đăng ký khung giờ trong task **Khám sức khoẻ 2026** (dự án Hành chính – Nhân sự) trước **thứ 3 (13/10)**",
          "- Nhịn ăn sáng từ 22h tối hôm trước để xét nghiệm máu",
          "- Ca trực sáng 17/10 khám theo đợt, trưởng ca sắp xếp"
        ),
        react: { "👍": ["linh", "lead1", "nv04", "nv15"], "🙏": ["nv03", "nv12"], "✅": ["khoa"] },
        thread: [
          { by: "nv03", gap: 14, text: "Uống nước lọc được không ạ?" },
          { by: "admin", gap: 4, text: "Nước lọc được nha em." },
          { by: "khoa", gap: 10, text: "QC chia 2 đợt 7h và 9h30 nha" },
        ]
      }
    ]
  },
  // 8/10 — khách Nhật thử nghiệm
  {
    where: TB, date: "2026-10-08", time: "10:00",
    lines: [
      {
        by: "linh",
        text: "Thông tin chung: từ tuần sau công ty chạy **thử nghiệm với khách Nhật mới** (cắt nền sản phẩm, yêu cầu viền rất kỹ). Giai đoạn đầu chỉ nhóm do anh Khoa và trưởng ca chọn thực hiện. Mọi người **không trao đổi về khách này ngoài kênh sản xuất và task** nhé, theo nội quy bảo mật.",
        react: { "👍": ["boss", "khoa", "acc1", "nv15"], "👀": ["nv01", "nv06", "nv13"] },
        thread: [
          { by: "nv06", gap: 9, text: "Em muốn đăng ký vào nhóm, test ở đâu ạ?" },
          { by: "khoa", gap: 5, text: "Thứ 3 tuần sau test 5 ảnh cắt nền, đăng ký trong #qc-chat-luong nha." },
          { by: "nv01", gap: 3, text: "Dạ em cũng đăng ký ạ" }
        ]
      }
    ]
  },
  // 9/10 — website mới
  {
    where: TB, date: "2026-10-09", time: "09:00",
    lines: [
      {
        by: "boss",
        text: L(
          "## Website mới ra mắt 15/10",
          "Sau 1 tháng, An và anh Minh đã hoàn thiện website mới của công ty: giao diện mới, trang before/after kéo thả, trang tuyển dụng có form ứng tuyển.",
          "- Ra mắt chính thức: **thứ 5 (15/10)**",
          "- Mọi người xem bản thử và góp ý trong #chung trước 12/10",
          "- Ngày ra mắt nhờ cả nhà chia sẻ bài trên trang cá nhân 🙏"
        ),
        edited: L(
          "## Website mới ra mắt 15/10",
          "Sau 1 tháng, An và anh Minh đã hoàn thiện website mới của công ty: giao diện mới, trang before/after kéo thả, trang tuyển dụng có form ứng tuyển.",
          "- Ra mắt chính thức: **thứ 5 (15/10)**",
          "- Bản thử: [nesso.example/preview](https://nesso.example/preview) — góp ý trong #chung trước **thứ 2 (12/10)**",
          "- Ngày ra mắt nhờ cả nhà chia sẻ bài trên trang cá nhân 🙏"
        ),
        react: {
          "🔥": ["an", "minh", "linh", "nv02", "nv05", "nv15"],
          "🎉": ["admin", "acc1", "acc2", "nv09"],
          "👏": ["khoa", "lead1"]
        },
        thread: [
          { by: "an", gap: 7, text: "Em cảm ơn anh ạ, mọi người góp ý thẳng tay nha 😁" },
          { by: "minh", gap: 5, text: "Bản thử đã chạy https đầy đủ, xem được trên mọi trình duyệt rồi." },
          { by: "nv02", gap: 6, text: "Đẹp quá An ơi 😍" },
          { by: "acc1", gap: 20, text: "Sau 15/10 em sẽ gửi link website mới cho khách cũ ạ" }
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-10-09", time: "15:30",
    lines: [
      {
        by: "linh",
        text: "Từ tháng 11, khối văn phòng làm thứ 7 **luân phiên** (mỗi người 2 thứ 7/tháng). Lịch phân công có trước 25/10. Sản xuất giữ nguyên theo ca.",
        react: { "🎉": ["an", "acc1", "acc2", "minh", "admin"], "❤️": ["khoa"], "😮": ["nv09", "nv15"] },
        thread: [
          { by: "acc2", gap: 8, text: "Account vẫn cần 1 người trực mỗi thứ 7 đúng không chị?" },
          { by: "linh", gap: 4, text: "Đúng rồi, account và IT luân phiên sao cho thứ 7 nào cũng có người." },
          { by: "nv09", gap: 12, text: "Sản xuất có được áp dụng không ạ 🥲" },
          { by: "linh", gap: 6, text: "Sản xuất chạy theo ca nên chưa em, chị sẽ xem xét sau Q4 nhé." }
        ]
      }
    ]
  },
  // 10/10 (thứ 7, hôm nay)
  {
    where: TB, date: "2026-10-10", time: "09:00",
    lines: [
      {
        by: "admin",
        text: "Nhắc: còn **14 bạn** chưa đăng ký khung giờ khám sức khoẻ 17/10. Hạn chót thứ 3 (13/10) nha, sau hạn mình xếp ngẫu nhiên 😄",
        react: { "👀": ["nv03", "nv08", "nv15"], "😂": ["nv05", "an"] },
        thread: [
          { by: "nv11", gap: 7, text: "Em đăng ký rồi ạ" },
          { by: "lead2", gap: 12, text: "Ca B mình nhắc cả nhóm rồi nhé" }
        ]
      }
    ]
  },
  {
    where: TB, date: "2026-10-10", time: "15:10",
    lines: [
      {
        by: "linh",
        text: L(
          "## Kế hoạch 20/10 – Ngày Phụ nữ Việt Nam 💐",
          "Năm nay mình làm 3 hoạt động, mọi người vote giúp chị lựa chọn chính trong thread nhé:",
          "1. Trưa thứ 3 (20/10): ăn trưa chung cả công ty (buffet hoặc đặt tiệc tại văn phòng)",
          "2. Chiều 20/10: workshop cắm hoa hoặc làm nến thơm khoảng 1 tiếng",
          "3. Quà tặng cho tất cả chị em; ca đêm và ca B có buổi riêng",
          "",
          "Ban tổ chức: @{admin}, An, @{nv02}, @{nv10}. Hạn vote: **17h thứ 2 (12/10)**."
        ),
        react: {
          "❤️": ["an", "admin", "nv02", "nv05", "nv09", "nv15"],
          "🎉": ["acc1", "acc2", "nv01", "nv12", "nv14", "nv10"]
        },
        thread: [
          { by: "nv02", gap: 6, text: "Em vote 2 – workshop cắm hoa ạ 💐" },
          { by: "nv05", gap: 3, text: "Em vote 1, ăn trưa chung là vui nhất 😋" },
          { by: "an", gap: 5, text: "Nếu chọn workshop em lo backdrop chụp ảnh, có ảnh đăng fanpage luôn" },
          { by: "admin", gap: 8, text: "@{boss} anh duyệt giúp em ngân sách sơ bộ trong task **Kế hoạch 20/10** nhé, em đính kèm 2 phương án rồi ạ." },
          { by: "acc2", gap: 6, text: "Em vote 1 + 3 ạ, account trực thứ 7 xin nhận quà sớm 1 hôm nha 😁" },
          { by: "khoa", gap: 12, text: "Workshop nên để sau 16h cho QC kịp duyệt đơn buổi chiều ạ. @{boss} anh thấy được không?" },
          { by: "nv09", gap: 4, text: "Em vote 2 ạ 🙋" },
          { by: "linh", gap: 15, text: "Chị ghi nhận hết nha. @{boss} anh chốt giúp em phương án trước thứ 2 để em đặt chỗ ạ." }
        ]
      }
    ]
  }
];

export const scenesGeneral: ChatScene[] = [...chung, ...thongBao];
