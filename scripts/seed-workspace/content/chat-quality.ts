import type { ChatScene } from "../types.js";

/**
 * Chat scenes for #qc-chat-luong (public) and #leader-san-xuat (private: boss, linh, lead1, lead2, khoa).
 * INVENTED content for the local test-data seed — no real clients, prices or staff names.
 * In #leader-san-xuat production staff are referred to by role only (private channel: only members may be mentioned).
 */
export const scenesQuality: ChatScene[] = [
  // ───────────────────────────── #qc-chat-luong ─────────────────────────────
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-08-25",
    time: "10:15",
    lines: [
      {
        by: "khoa",
        text: "Chào cả nhà 👋 Từ hôm nay mọi ghi chú QC sẽ đăng ở kênh này thay cho nhóm Zalo cũ nhé.\n\n**Quy ước:**\n- Mỗi lỗi kèm ảnh before/after và loại job (HDR, sky, staging, cut-out...)\n- Có thắc mắc thì trả lời **trong thread** của lỗi đó, đừng nhắn riêng\n- Thứ Bảy anh tổng hợp tỉ lệ QC fail của tuần\n\nCó gì chưa rõ cứ hỏi anh.",
        react: { "👍": ["linh", "lead1", "lead2", "nv01", "nv04", "nv09"], "✅": ["boss"] },
        thread: [
          { by: "lead1", text: "Ok anh, ca A mình sẽ nhắc các bạn bật thông báo kênh này.", gap: 4 },
          { by: "nv06", text: "Dạ cho em hỏi ảnh lỗi cũ trên Zalo có chuyển qua đây không anh?", gap: 9 },
          { by: "khoa", text: "Không chuyển hết em, anh sẽ gom 10 lỗi hay gặp nhất thành 1 bài ghim ở đây.", gap: 6 },
          { by: "nv06", text: "Dạ vâng ạ 👍", gap: 2 }
        ]
      },
      {
        by: "boss",
        text: "Tốt. Anh muốn mỗi tuần nhìn được con số fail rate rõ ràng, tách theo từng loại job nếu được nhé @{khoa}.",
        gap: 6,
        react: { "👍": ["khoa", "linh"] }
      },
      { by: "khoa", text: "Dạ được anh, từ tuần này em tách theo loại job luôn ạ.", gap: 3 },
      {
        by: "linh",
        text: "Các trưởng ca nhắc team đọc kênh này đầu ca nha @{lead1} @{lead2}",
        gap: 4,
        react: { "✅": ["lead1", "lead2"] }
      },
      { by: "lead2", text: "Dạ chị, ca B vào 13:30 em nhắc luôn ạ.", gap: 2 },
      { by: "nv11", text: "Em vô kênh rồi ạ 🙋", gap: 5 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-08-26",
    time: "14:20",
    lines: [
      {
        by: "khoa",
        text: "**Lỗi #1 — Halo quanh mái nhà khi thay trời**\n\nSáng nay QC trả lại 6 ảnh sky replacement của khách BĐS bên Úc, cùng một lỗi: viền sáng mờ chạy dọc mép mái ngói, zoom 100% là thấy rõ.\n\nNguyên nhân hay gặp:\n- Select Sky xong không Refine Edge lại phần mái\n- Feather mask quá lớn (5–10px)\n- Không Decontaminate Colors nên mép còn ám màu trời cũ\n\nẢnh before/after bên dưới 👇",
        files: [
          { name: "halo-mai-nha-before.jpg", hint: "zoom 100% roofline with bright soft halo after sky replacement" },
          { name: "halo-mai-nha-after.jpg", hint: "same roofline fixed, clean tile edge against blue sky" }
        ],
        react: { "👀": ["nv02", "nv03", "nv07"], "👍": ["lead1", "boss"] },
        thread: [
          { by: "nv03", text: "Dạ 3 ảnh trong đó là của em ạ 😢 Em feather 6px vì sợ viền bị cứng.", gap: 7 },
          { by: "khoa", text: "Không sao em. Mái ngói thì feather 0,5–1px là đủ, chỗ cây lá mới cần mềm hơn. Em sửa lại rồi gửi anh check nhé.", gap: 4 },
          { by: "nv03", text: "Dạ em sửa xong rồi, đã đẩy lại thư mục QC ạ.", gap: 40 },
          { by: "khoa", text: "Ok sạch rồi 👍", gap: 12 }
        ]
      },
      { by: "nv07", text: "Anh ơi mái tôn màu tối thì dùng Select Sky hay channel mask tốt hơn ạ?", gap: 5 },
      {
        by: "khoa",
        text: "Mái tối, trời sáng thì channel mask (kênh Blue) ra mép đẹp hơn em. Select Sky hay ăn lẹm vào máng xối.",
        gap: 3,
        react: { "💯": ["nv07", "lead2"] }
      },
      { by: "nv07", text: "Dạ em hiểu rồi, cảm ơn anh.", gap: 2 },
      { by: "lead1", text: "Ca A tuần này có 2 bạn mới làm sky, chiều nay mình ngồi kèm @{nv13} và @{nv14} nhé.", gap: 6 },
      { by: "nv13", text: "Dạ em cảm ơn ạ.", gap: 2 },
      { by: "nv14", text: "Dạ 3h em qua bàn mình ạ.", gap: 1 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-08-27",
    time: "09:40",
    lines: [
      {
        by: "khoa",
        text: "**Lỗi #2 — Cửa sổ cháy sáng (window pull)**\n\nẢnh nội thất HDR mà ô cửa trắng xoá, không thấy cảnh bên ngoài là khách Úc trả về 100%. Hôm qua có 4 ảnh như vậy.\n\n@{nv05} @{nv10} hai em xem lại giúp anh, dùng frame tối nhất để kéo cửa sổ nhé.",
        files: [{ name: "window-pull-loi.jpg", hint: "living room HDR, windows blown out pure white" }],
        react: { "👀": ["nv05", "nv10"] }
      },
      { by: "nv05", text: "Dạ anh, ảnh của em là do bộ bracket chỉ có 3 frame, frame tối nhất cửa vẫn hơi cháy ạ.", gap: 4 },
      { by: "nv10", text: "Em thì quên mask lại vùng khung cửa, em sửa ngay ạ.", gap: 2 },
      {
        by: "khoa",
        text: "@{nv05} trường hợp frame tối vẫn cháy thì báo trưởng ca để account hỏi khách, không tự ghép cảnh ngoài cửa sổ nhé. Khách đồng ý mới làm.",
        gap: 3,
        react: { "🙏": ["nv05"], "👍": ["acc1"] }
      },
      { by: "acc1", text: "Đúng rồi ạ, đa số khách Úc bên mình cho phép thay cảnh ngoài cửa sổ, nhưng phải hỏi trước. Bạn nào gặp cứ tag mình.", gap: 5 },
      {
        by: "lead2",
        text: "Mình sẽ thêm vào note đầu ca: **cửa sổ phải thấy được cảnh ngoài**, trừ khi đã báo account.",
        gap: 4,
        react: { "✅": ["khoa"] }
      },
      {
        by: "nv10",
        text: "Em sửa xong 2 ảnh rồi ạ, anh xem giúp em.",
        gap: 35,
        files: [{ name: "window-pull-sua-lai.jpg", hint: "same living room, windows now showing garden outside, balanced exposure" }],
        thread: [
          { by: "khoa", text: "Ổn rồi em. Chú ý chỗ rèm hơi bị xám, lần sau mask mềm hơn chút.", gap: 8 },
          { by: "nv10", text: "Dạ em rút kinh nghiệm ạ.", gap: 2 }
        ]
      }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-08-28",
    time: "16:00",
    lines: [
      {
        by: "khoa",
        text: "💡 **Mẹo tự kiểm 2 phút trước khi đẩy file**\n\n1. Zoom 100%, chạy dọc mép mái và tán cây\n2. Bật lưới kiểm tra đường dọc\n3. Mở Info panel, chấm thử tường trắng\n4. Tắt/bật layer trời để so với ảnh gốc\n5. Xem ảnh ở kích thước nhỏ như thumbnail — lỗi màu lộ rõ hơn\n\nLàm quen tay thì không mất thời gian đâu.",
        react: { "👍": ["nv01", "nv02", "nv08", "nv12", "lead1"], "💯": ["linh"] }
      },
      { by: "nv09", text: "Em thêm 1 mẹo: tạo action phím F2 bật lớp Curves đen trắng để soi halo, nhìn ra liền ạ.", gap: 6, react: { "🔥": ["khoa", "nv04"] } },
      { by: "khoa", text: "Hay đó @{nv09}, em quay màn hình ngắn gửi vào đây cho mọi người nhé.", gap: 3 },
      { by: "nv09", text: "Dạ mai em gửi ạ 😄", gap: 2 },
      { by: "nv02", text: "Mục 5 hay thật, ảnh nhỏ nhìn trời xanh lè thấy liền 😂", gap: 4, react: { "😂": ["nv09", "nv04"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-08-29",
    time: "10:30",
    lines: [
      {
        by: "khoa",
        text: "## QC tuần 35 (24–29/8)\n\n- Tổng ảnh QC: 3.420\n- Ảnh bị trả lại: 233 → **fail rate 6,8%**\n- HDR nội thất: 8,1% (chủ yếu cửa sổ cháy, WB)\n- Sky replacement: 7,4% (halo mái nhà)\n- Virtual staging: 5,2%\n- Cut-out sản phẩm: 3,0%\n\nMục tiêu cuối tháng 10: **dưới 4%**.",
        files: [{ name: "qc-fail-rate-tuan-35.xlsx", hint: "weekly QC fail rate by job type, week 35" }],
        react: { "👀": ["linh", "lead1"], "👍": ["boss", "lead2"] },
        thread: [
          { by: "boss", text: "HDR nội thất 8% là cao. Có bạn nào lỗi lặp lại nhiều không em?", gap: 12 },
          { by: "khoa", text: "Dạ có 3 bạn chiếm gần một nửa số lỗi HDR, em đã trao đổi với trưởng ca. Chủ yếu là các bạn mới chuyển từ cut-out sang ạ.", gap: 5 },
          { by: "boss", text: "Ok. Cho các bạn đó kèm cặp thêm 1 tuần, tuần sau anh xem lại số.", gap: 4 },
          { by: "lead1", text: "Dạ em sắp xếp ạ.", gap: 3 }
        ]
      },
      { by: "linh", text: "Mục tiêu 4% hơi gắt nhưng chị nghĩ làm được nếu có checklist rõ ràng.", gap: 8, react: { "💯": ["khoa"] } },
      {
        by: "khoa",
        text: "Dạ em đang viết bản checklist mới, chắc cuối tháng 9 có bản nháp ạ.",
        edited: "Dạ em đang viết bản checklist mới (v2), chắc cuối tháng 9 có bản nháp ạ.",
        gap: 3
      },
      { by: "nv04", text: "Tuần này em 0 lỗi nha anh 😁", gap: 6, react: { "👏": ["khoa", "lead1", "nv09"], "🎉": ["nv02"] } },
      { by: "khoa", text: "Chuẩn rồi, @{nv04} giữ phong độ nhé 👏", gap: 2 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-08-31",
    time: "15:00",
    lines: [
      {
        by: "khoa",
        text: "**Lỗi #3 — Đường dọc bị nghiêng**\n\nTường, khung cửa, cạnh tủ phải thẳng đứng 100%. Hôm nay có mấy ảnh nghiêng 1–2 độ, mắt thường cũng thấy.\n\nCách làm chuẩn:\n1. Camera Raw → Geometry → **Vertical** (hoặc Guided, kéo 2 đường dọc)\n2. Bật lưới khi kiểm tra (View → Show → Grid)\n3. Crop lại phần viền trắng sau khi transform, không để lộ viền",
        files: [{ name: "duong-doc-nghieng-before-after.png", hint: "side by side: tilted kitchen walls vs corrected vertical lines with grid overlay" }],
        react: { "👍": ["nv01", "nv08", "lead2"] }
      },
      {
        by: "nv12",
        text: "Anh ơi ảnh góc rộng mà dựng thẳng hết thì đồ đạc gần ống kính bị kéo dài, vậy có được để nghiêng nhẹ không ạ?",
        gap: 5,
        thread: [
          { by: "khoa", text: "Câu hỏi hay. Chuẩn của mình vẫn là thẳng hết, nhưng biến dạng nặng thì giảm Vertical còn khoảng 80–90% rồi bù bằng Transform tay. Không để tường nghiêng.", gap: 4 },
          { by: "nv12", text: "Dạ vậy em dùng Guided kết hợp chỉnh Aspect phải không anh?", gap: 3 },
          { by: "khoa", text: "Đúng rồi, Aspect -10 đến -20 là hết cảm giác kéo dài.", gap: 2 },
          { by: "nv12", text: "Dạ em cảm ơn ạ 🙏", gap: 1 }
        ]
      },
      { by: "nv08", text: "Em hay quên crop viền trắng sau transform 😅 lần trước khách bắt được 1 ảnh.", gap: 7 },
      { by: "lead2", text: "@{nv08} thêm bước zoom kiểm 4 góc trước khi xuất là hết em.", gap: 3, react: { "👍": ["nv08"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-03",
    time: "09:15",
    lines: [
      {
        by: "khoa",
        text: "Chào cả nhà, hết lễ rồi 🎉 Tổng kết ca trực 1–2/9: 2 ngày làm 410 ảnh, QC trả 19 ảnh, chủ yếu WB ám vàng ở nội thất. Cảm ơn các bạn trực lễ 🙏",
        react: { "🙏": ["linh", "lead1"], "👏": ["boss", "nv02", "nv06"] }
      },
      {
        by: "boss",
        text: "Cảm ơn các em ca trực. Lễ mà vẫn giữ được chất lượng là tốt.",
        gap: 10,
        react: { "❤️": ["nv05", "nv11", "lead2"] }
      },
      { by: "nv05", text: "Dạ ca trực tụi em làm hơi vội nên WB chưa kỹ, em xin lỗi ạ.", gap: 6 },
      { by: "khoa", text: "Không sao em, trong tuần anh viết hướng dẫn WB riêng.", gap: 3 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-05",
    time: "10:20",
    lines: [
      {
        by: "khoa",
        text: "## QC tuần 36 (31/8–5/9, có 2 ngày lễ)\n\n- Ảnh QC: 2.610\n- Fail: 159 → **6,1%** (giảm 0,7 điểm so với tuần 35)\n- Lỗi nhiều nhất: WB ám vàng (31%), cửa sổ cháy (22%), halo mái nhà (17%)\n\nTuần sau tập trung xử lý WB nhé các bạn.",
        react: { "👍": ["linh", "boss", "lead2"], "🔥": ["nv03"] }
      },
      { by: "linh", text: "Có tiến bộ 👏 Cố lên cả nhà.", gap: 6, react: { "❤️": ["nv01", "nv14"] } },
      { by: "lead1", text: "Ca A tuần này fail 5,4%, ca B 6,9% đúng không anh?", gap: 4 },
      { by: "khoa", text: "Đúng rồi, ca B dính nhiều ảnh trực lễ hơn. @{lead2} không đáng lo đâu.", gap: 3 },
      { by: "lead2", text: "Dạ, tuần sau ca B kéo xuống 👊", gap: 2 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-08",
    time: "14:00",
    lines: [
      {
        by: "khoa",
        text: "**Lỗi #4 — Cân bằng trắng ám vàng**\n\nNội thất có đèn sợi đốt, đèn âm trần vàng → tường trắng thành màu kem/cam. Khách Úc muốn **tường trắng ra trắng**, giữ chút ấm ở bóng đèn là được.\n\n- Dùng eyedropper xám lấy mẫu ở tường trắng có ánh sáng tự nhiên, không lấy gần bóng đèn\n- Kiểm tra bằng Info panel: R, G, B lệch nhau không quá 5\n- Trần nhà thường ám nặng nhất, mask riêng nếu cần",
        files: [
          { name: "wb-am-vang-before.jpg", hint: "bedroom interior, walls strongly yellow from tungsten lights" },
          { name: "wb-am-vang-after.jpg", hint: "same bedroom, neutral white walls, warm lamp glow kept" }
        ],
        react: { "👍": ["nv05", "nv12", "nv15"], "🔥": ["lead1"], "👀": ["boss"] },
        thread: [
          { by: "nv15", text: "Anh ơi ảnh mà cả phòng không có chỗ nào trắng thì lấy mẫu ở đâu ạ?", gap: 6 },
          { by: "khoa", text: "Lấy ở khung cửa sổ, ổ cắm điện hoặc trần. Không có nữa thì chỉnh tay theo Info, sàn gỗ đừng để ngả đỏ quá.", gap: 4 },
          { by: "nv15", text: "Dạ em cảm ơn anh.", gap: 1 },
          { by: "nv09", text: "Em hay dùng thêm Selective Color giảm Yellow trong Whites, cũng được anh nhỉ?", gap: 7 },
          { by: "khoa", text: "Được, nhưng nhẹ tay, giảm quá là tường bị xanh lơ.", gap: 3 }
        ]
      },
      { by: "nv12", text: "Mấy ảnh mix đèn LED trắng + đèn vàng thì sao anh, chỉnh 1 phát không hết được ạ.", gap: 8 },
      { by: "khoa", text: "Ảnh mix thì chỉnh WB theo vùng sáng tự nhiên trước, sau đó mask vùng đèn vàng giảm saturation. Mai anh quay video ngắn hướng dẫn.", gap: 4 },
      { by: "lead1", text: "Video xong anh gửi vào kênh luôn nha, ca A sẽ xem đầu ca.", gap: 3 },
      { by: "khoa", text: "Ok 👍", gap: 1 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-10",
    time: "16:10",
    lines: [
      {
        by: "khoa",
        text: "**Lỗi #5 — Bóng đổ giả trong virtual staging**\n\nSofa, bàn ăn chèn vào nhưng bóng đổ không khớp hướng sáng → nhìn như đồ đang lơ lửng. Ảnh dưới: cửa sổ bên trái mà bóng lại hắt sang trái 😅",
        files: [{ name: "bong-do-gia-staging.jpg", hint: "virtual staging living room, sofa shadow pointing wrong direction, floating look" }],
        react: { "😂": ["nv02", "nv08"], "👀": ["nv06"] }
      },
      { by: "nv08", text: "Ảnh này của em ạ 🙈 em lấy bóng từ bộ asset có sẵn mà quên lật.", gap: 4 },
      {
        by: "khoa",
        text: "Asset có sẵn bóng thì xoá đi rồi vẽ lại theo nguồn sáng của ảnh thật. Quy tắc nhanh:\n- Bóng tiếp xúc (contact shadow) ngay chân đồ: đậm, sắc\n- Bóng đổ xa: mờ dần, theo hướng ngược cửa sổ\n- Độ đậm không hơn bóng của đồ thật trong phòng",
        gap: 3,
        react: { "💯": ["lead2", "nv08"], "👍": ["nv01"] },
        thread: [
          { by: "nv06", text: "Anh ơi phòng có cả đèn trần và cửa sổ thì theo nguồn nào ạ?", gap: 5 },
          { by: "khoa", text: "Ban ngày thì theo cửa sổ là chính, đèn trần chỉ tạo contact shadow nhẹ dưới chân thôi.", gap: 3 },
          { by: "nv06", text: "Dạ rõ rồi ạ.", gap: 1 }
        ]
      },
      {
        by: "nv08",
        text: "Em sửa lại rồi anh xem giúp ạ.",
        gap: 45,
        files: [{ name: "bong-do-staging-da-sua.jpg", hint: "same staging, sofa shadow now matching window light from left" }],
        react: { "👍": ["khoa"] }
      },
      { by: "khoa", text: "Ok rồi em, contact shadow đẹp 👍", gap: 6 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-12",
    time: "10:40",
    lines: [
      {
        by: "khoa",
        text: "## QC tuần 37 (7–12/9)\n\n- Ảnh QC: 3.890\n- Fail: 210 → **5,4%**\n- WB ám vàng giảm còn 14% tổng lỗi (tuần trước 31%) 👏\n- Lỗi mới nổi: bóng đổ giả trong staging\n\nTuyên dương: @{nv04}, @{nv09}, @{nv01} — cả tuần 0 lỗi.",
        react: { "👏": ["boss", "linh", "lead1", "nv02", "nv11"], "🎉": ["nv04", "nv09"] },
        thread: [
          { by: "boss", text: "Tốt lắm 3 em 👏 Tuần sau đơn Úc về nhiều, giữ phong độ nhé.", gap: 9 },
          { by: "nv09", text: "Dạ em cảm ơn anh ạ!", gap: 2 },
          { by: "nv01", text: "Em cảm ơn anh, tuần sau em cố tiếp ạ.", gap: 3 },
          { by: "nv04", text: "Hehe cảm ơn sếp ạ 😁", gap: 2 }
        ]
      },
      {
        by: "linh",
        text: "Video WB của anh Khoa hiệu quả ghê, ai chưa xem thì xem nhé: [Hướng dẫn WB nội thất](https://nesso.example/qc/video-wb-noi-that)",
        gap: 7,
        react: { "👍": ["nv12", "nv15"] }
      },
      { by: "lead2", text: "Tuần sau ca B có thêm ca đêm, mình sẽ nhắc tự kiểm kỹ hơn vì làm đêm hay mỏi mắt.", gap: 5 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-14",
    time: "08:05",
    lines: [
      {
        by: "khoa",
        text: "⚠️ **Tuần cao điểm đơn Úc 14–19/9**\n\nĐể kịp deadline, QC tuần này kiểm:\n- 100% ảnh sky replacement và window pull (khách hay complain nhất)\n- 30% ngẫu nhiên các loại còn lại\n\nCác bạn tự kiểm 3 điểm trước khi đẩy file:\n[ ] Mép mái nhà/cây không halo\n[ ] Cửa sổ thấy cảnh ngoài\n[ ] Tường thẳng, không viền trắng\n\nĐừng vì vội mà bỏ qua nhé 🙏",
        react: { "👍": ["lead1", "lead2", "nv03", "nv07", "nv10", "nv13"], "🔥": ["boss"] }
      },
      {
        by: "boss",
        text: "Tuần này quan trọng, các em cố lên. Ăn khuya và taxi ca đêm công ty lo hết.",
        gap: 7,
        react: { "❤️": ["nv05", "nv11", "nv14"], "🙏": ["lead2"] }
      },
      { by: "lead1", text: "Ca A từ mai bắt đầu 7:00 nha các bạn, sớm hơn 30 phút.", gap: 4 },
      { by: "nv14", text: "Dạ em nắm rồi ạ.", gap: 2 },
      {
        by: "acc1",
        text: "Đơn đầu tiên 180 ảnh HDR deadline 14:00 giờ mình, mình đã chia trong task rồi nhé.",
        edited: "Đơn đầu tiên 180 ảnh HDR deadline 14:00 giờ mình (chiều bên Úc), mình đã chia trong task rồi nhé.",
        gap: 5,
        react: { "👀": ["lead1"] }
      }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-15",
    time: "19:30",
    lines: [
      {
        by: "acc1",
        text: "Khách Úc phản hồi đơn hôm qua: **trời quá xanh, hơi ngả tím** ở 12 ảnh twilight. Khách muốn trời tự nhiên hơn, xanh nhạt, có chút mây.",
        files: [{ name: "phan-hoi-mau-troi.png", hint: "screenshot of client markup circling purple-blue sky on twilight photo" }],
        react: { "😮": ["khoa", "nv11"], "👀": ["lead2"] }
      },
      {
        by: "khoa",
        text: "Thấy rồi. Thư viện trời twilight có mấy tấm bão hoà cao quá, anh sẽ đánh dấu loại ra. @{nv11} @{nv13} ca đêm nay sửa 12 ảnh này nhé, Hue trời giữ quanh 205–215, saturation giảm 15–20%.",
        gap: 6,
        thread: [
          { by: "lead2", text: "Mình tạo luôn folder **sky-chuan** trên NAS để các bạn chỉ lấy trời trong đó nhé anh?", gap: 4 },
          { by: "khoa", text: "Đúng, mai anh lọc xong sẽ có khoảng 40 tấm trời chuẩn, mấy tấm cũ bỏ hết.", gap: 3 },
          { by: "boss", text: "Làm sớm việc này em, lỗi này lặp lại là mất khách.", gap: 50 },
          { by: "khoa", text: "Dạ sáng mai em xong ạ.", gap: 4 }
        ]
      },
      { by: "nv11", text: "Dạ em nhận 6 ảnh đầu ạ.", gap: 3 },
      { by: "nv13", text: "Em nhận 6 ảnh sau ạ.", gap: 1 },
      {
        by: "nv11",
        text: "Anh Khoa ơi em sửa xong 6 ảnh, anh xem mẫu này được chưa ạ?",
        gap: 70,
        files: [{ name: "twilight-sky-sua.jpg", hint: "twilight house exterior, softer natural blue-orange sky" }]
      },
      { by: "khoa", text: "Đẹp rồi em, cả lô làm theo tông này nhé 👍", gap: 8, react: { "🙏": ["nv11", "nv13"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-16",
    time: "11:00",
    lines: [
      {
        by: "lead1",
        text: "Hàng chờ QC đang tồn khoảng 400 ảnh, deadline chiều nay có 2 đơn. Anh @{khoa} ưu tiên đơn nào trước ạ?",
        react: { "👀": ["khoa"] }
      },
      { by: "khoa", text: "Ưu tiên đơn có deadline 14:00 trước, đơn 17:00 để sau. Ảnh exterior check hết, nội thất check mẫu.", gap: 3 },
      { by: "boss", text: "@{khoa} có cần thêm người check không? Trưởng ca phụ được không?", gap: 6 },
      { by: "khoa", text: "Dạ được anh, @{lead1} check giúp em phần nội thất ca A, em tập trung exterior.", gap: 2 },
      { by: "lead1", text: "Ok anh, mình bắt đầu luôn.", gap: 1, react: { "🙏": ["khoa"] } },
      { by: "nv10", text: "Anh ơi em đẩy nhầm 20 ảnh chưa xong vào folder QC ạ", gap: 9, deleted: true },
      { by: "nv10", text: "Em đã rút lại 20 ảnh đẩy nhầm, chút nữa em đẩy lại bản hoàn chỉnh ạ 🙏", gap: 2 },
      { by: "khoa", text: "Ok em, lần sau xem kỹ tên folder nhé.", gap: 3 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-17",
    time: "10:00",
    lines: [
      {
        by: "acc1",
        text: "Thêm 1 phản hồi: đơn 240 ảnh HDR hôm 15/9 có 9 ảnh cửa sổ bị kéo quá tay, cảnh ngoài sáng hơn cả trong phòng, nhìn giả.",
        react: { "😢": ["nv05"], "👀": ["khoa"] }
      },
      {
        by: "khoa",
        text: "Lần trước là cháy, giờ thì kéo quá 😅 Nguyên tắc: cảnh ngoài cửa sổ **tối hơn trong phòng khoảng ½–1 stop**, giữ chút sáng ở mép kính cho tự nhiên.",
        gap: 5,
        files: [{ name: "window-pull-qua-tay-vs-chuan.jpg", hint: "comparison: overpulled window view too bright vs natural balanced window view" }],
        react: { "👍": ["nv05", "nv10", "nv07"], "💯": ["lead1"] }
      },
      {
        by: "boss",
        text: "@{khoa} lỗi này do vội hay do mình chưa có chuẩn?",
        gap: 8,
        thread: [
          { by: "khoa", text: "Dạ chủ yếu do chưa có chuẩn rõ anh ạ. Mỗi bạn kéo một kiểu, tuần này QC lại chỉ check mẫu nên lọt.", gap: 4 },
          { by: "boss", text: "Vậy đưa tiêu chí này vào checklist luôn, có ảnh chuẩn để các em so.", gap: 3 },
          { by: "khoa", text: "Dạ em sẽ đưa vào checklist v2, kèm bộ ảnh mẫu ạ.", gap: 2 },
          { by: "linh", text: "Chị đồng ý, mỗi tiêu chí nên có 1 cặp ảnh đúng/sai.", gap: 6 }
        ]
      },
      { by: "nv07", text: "9 ảnh đó em sửa lại xong rồi ạ, em đã gửi account.", gap: 50 },
      { by: "acc1", text: "Cảm ơn @{nv07}, mình gửi khách lúc 11:30 rồi nhé.", gap: 4, react: { "🙏": ["nv07"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-19",
    time: "15:30",
    lines: [
      {
        by: "khoa",
        text: "Hết tuần cao điểm rồi cả nhà ơi 🎉\n\nSố sơ bộ tuần 38: QC 6.120 ảnh, fail 563 → **9,2%**. Tăng mạnh do khối lượng gấp đôi và QC chỉ check mẫu. 3 lỗi chính: màu trời twilight, window pull, halo mái nhà.\n\nThứ Ba anh phân tích kỹ. Cảm ơn mọi người đã cày ca đêm 🙏",
        react: { "🙏": ["linh", "lead1", "lead2", "nv03"], "😢": ["nv06"], "👏": ["boss"] },
        thread: [
          { by: "boss", text: "9% là cao nhưng làm gấp đôi khối lượng thì anh hiểu. Quan trọng là không để lỗi lặp lại.", gap: 14 },
          { by: "khoa", text: "Dạ, em sẽ đề xuất cách làm cho đợt cao điểm sau ạ.", gap: 3 },
          { by: "lead2", text: "Ca đêm mệt mà vui anh ơi 😂", gap: 5 },
          { by: "boss", text: "Nghỉ ngơi đi các em, thứ Hai làm lại bình thường.", gap: 4 }
        ]
      },
      { by: "nv02", text: "Cuối cùng cũng xong 🥲 cảm ơn anh Khoa đã check cho tụi em tới khuya.", gap: 6 },
      { by: "khoa", text: "Mọi người vất vả rồi, Chủ nhật nghỉ cho khoẻ nhé.", gap: 3, react: { "❤️": ["nv02", "nv09", "nv14"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-21",
    time: "10:30",
    lines: [
      {
        by: "khoa",
        text: "Sau khi chuyển NAS mới, thư mục ảnh mẫu QC đã đổi đường dẫn:\n`\\\\nas-moi\\QC\\anh-mau` (cũ: `\\\\nas\\qc-ref`)\n\nAi mở không được thì báo IT nhé.",
        react: { "👍": ["lead1", "nv03"] }
      },
      {
        by: "nv06",
        text: "Anh ơi em vào bị báo không có quyền truy cập ạ.",
        gap: 6,
        files: [{ name: "loi-quyen-truy-cap-nas.png", hint: "Windows access denied dialog for network folder" }]
      },
      { by: "nv10", text: "Em cũng bị y vậy ạ.", gap: 2 },
      {
        by: "lead1",
        text: "Mình báo anh Minh bên IT rồi, chắc nhóm quyền chưa gán cho ca A.",
        edited: "Mình báo anh Minh bên IT rồi, nhóm quyền ca A chưa được gán trên NAS mới, anh Minh đang xử lý.",
        gap: 4
      },
      {
        by: "khoa",
        text: "Trong lúc chờ thì xem tạm ảnh mẫu ở đây: [Ảnh mẫu QC (bản sao)](https://nesso.example/qc/anh-mau)",
        gap: 3,
        react: { "🙏": ["nv06", "nv10"] }
      },
      { by: "nv06", text: "Vào được rồi ạ, cảm ơn anh.", gap: 55, react: { "👍": ["lead1"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-22",
    time: "14:40",
    lines: [
      {
        by: "khoa",
        text: "## Phân tích lỗi tuần 38 (cao điểm)\n\nTổng 563 ảnh fail:\n1. Màu trời twilight sai tông — 27%\n2. Window pull (cháy hoặc kéo quá) — 24%\n3. Halo mái nhà/cây — 18%\n4. Đường dọc nghiêng, viền trắng — 12%\n5. WB ám vàng — 9%\n6. Khác — 10%\n\n**Đề xuất:**\n- Làm checklist v2: mỗi tiêu chí có ảnh đúng/sai\n- Mùa cao điểm sau QC check 100% ảnh exterior\n- Thư viện trời chỉ dùng folder sky-chuan\n\n@{boss} @{linh} anh chị xem giúp em ạ.",
        files: [{ name: "phan-tich-loi-tuan-38.pdf", hint: "QC error analysis week 38, pie chart of error categories" }],
        react: { "👀": ["boss", "linh"], "👍": ["lead1", "lead2"] },
        thread: [
          { by: "boss", text: "Đồng ý cả 3. Checklist v2 em cho anh deadline nhé.", gap: 18 },
          { by: "khoa", text: "Dạ bản nháp 24/9, bản chính thức áp dụng từ thứ Hai 5/10 ạ.", gap: 3 },
          { by: "boss", text: "Ok, chốt 5/10.", gap: 2 },
          { by: "linh", text: "Chị đưa vào task dự án QC để theo dõi nhé.", gap: 5 }
        ]
      },
      { by: "nv03", text: "Anh ơi checklist v2 có thêm phần cho cut-out sản phẩm không ạ?", gap: 8 },
      { by: "khoa", text: "Có em, có cả phần cho khách Nhật sắp tới, yêu cầu viền rất gắt.", gap: 3 },
      { by: "nv03", text: "Dạ 👍", gap: 1 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-24",
    time: "09:30",
    lines: [
      {
        by: "khoa",
        text: "📄 **QC Checklist v2 — bản nháp 1**\n\nMọi người góp ý trong thread này đến hết thứ Sáu nhé. Gồm 6 phần: HDR nội thất, exterior & sky, twilight, virtual staging, object removal, cut-out sản phẩm.",
        files: [{ name: "QC-checklist-v2-nhap-1.pdf", hint: "draft QC checklist v2, 6 sections with good/bad example thumbnails" }],
        react: { "👀": ["nv01", "nv02", "nv05", "nv12", "lead2"], "👍": ["linh"] },
        thread: [
          { by: "lead1", text: "Phần HDR nên thêm 1 dòng: kiểm tra màn hình TV/gương có phản chiếu người chụp không.", gap: 25 },
          { by: "nv12", text: "Em đề xuất ghi rõ thông số Hue trời luôn, chứ chữ 'tự nhiên' mỗi người hiểu một kiểu ạ.", gap: 30 },
          { by: "khoa", text: "Ý hay, anh sẽ để khoảng Hue cho từng loại trời.", gap: 6 },
          { by: "nv02", text: "Checklist dài quá anh ơi, 48 dòng làm sao nhớ hết 😅", gap: 20 },
          { by: "khoa", text: "Bản chính thức sẽ có bản tóm tắt 1 trang dán cạnh màn hình, bản đầy đủ để tra.", gap: 4 },
          { by: "lead2", text: "Ok vậy hợp lý.", gap: 3 }
        ]
      },
      { by: "nv14", text: "Em đọc xong rồi, phần object removal rất dễ hiểu ạ 👍", gap: 40 },
      { by: "khoa", text: "Cảm ơn em 😄", gap: 2 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-25",
    time: "11:00",
    lines: [
      {
        by: "khoa",
        text: "## QC tuần 39 (21–25/9)\n\nTuần này báo cáo sớm vì mai team building 🏖️\n\n- Ảnh QC: 3.540\n- Fail: 212 → **6,0%** (tuần 38: 9,2%)\n- Màu trời twilight còn 4% tổng lỗi — folder sky-chuan có tác dụng rõ\n\nTuyên dương @{nv11}, @{nv13}: sửa xong toàn bộ ảnh bị complain màu trời trong 1 đêm.",
        react: { "👏": ["boss", "linh", "nv11", "nv13", "lead2"], "🎉": ["nv04"] }
      },
      {
        by: "boss",
        text: "Giảm nhanh vậy là tốt. Chiều nay ăn bánh trung thu xong nhớ chụp hình đăng lên nhé 😄",
        gap: 9,
        react: { "😂": ["nv02", "nv09"], "❤️": ["khoa"] }
      },
      { by: "nv13", text: "Dạ em cảm ơn anh, đêm đó cà phê 2 ly luôn ạ 😂", gap: 4, react: { "😂": ["nv11", "lead2"] } },
      { by: "khoa", text: "Ca sản xuất ở lại mai vẫn làm bình thường nhé, QC có @{lead2} trực thay anh.", gap: 5 },
      { by: "lead2", text: "Dạ, mai ca B check mẫu 30% như thường.", gap: 2 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-28",
    time: "14:15",
    lines: [
      {
        by: "khoa",
        text: "📄 **Checklist v2 — bản nháp 2** đã cập nhật góp ý tuần trước:\n- Thêm khoảng Hue cho trời ban ngày / twilight (cảm ơn @{nv12})\n- Thêm kiểm tra phản chiếu trên gương, TV (cảm ơn @{lead1})\n- Thêm bản tóm tắt 1 trang\n- Phần cut-out: zoom 300%, không răng cưa, không viền trắng/đen",
        files: [{ name: "QC-checklist-v2-nhap-2.pdf", hint: "second draft QC checklist v2 with one-page summary" }],
        react: { "👍": ["lead1", "nv12", "nv01", "nv07"], "👀": ["boss"] }
      },
      {
        by: "lead2",
        text: "Phần twilight có ghi rõ độ sáng đèn trong nhà không anh? Khách hay kêu đèn quá vàng.",
        gap: 7,
        thread: [
          { by: "khoa", text: "Có, mục 3.4: đèn trong nhà ấm nhưng không cháy, không loang ra tường quá 1/3.", gap: 3 },
          { by: "lead2", text: "Ok, chuẩn rồi.", gap: 2 }
        ]
      },
      { by: "nv15", text: "Anh ơi bản tóm tắt có in ra cho mỗi máy không ạ?", gap: 6 },
      { by: "khoa", text: "Có, @{lead1} sẽ in và dán ở từng bàn trước 5/10.", gap: 2 },
      { by: "lead1", text: "Dạ để mình lo, cuối tuần này in xong.", gap: 3, react: { "🙏": ["khoa"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-09-30",
    time: "10:00",
    lines: [
      {
        by: "acc1",
        text: "Thông tin **khách Nhật mới** (chạy thử từ 1/10): cut-out sản phẩm gia dụng, nền trắng tinh, yêu cầu viền cực kỳ sạch.\n\n- Không răng cưa khi zoom 300%\n- Không còn viền trắng/xám quanh sản phẩm\n- Giữ phản chiếu tự nhiên nếu có, **không thêm bóng đổ giả**\n- Đơn thử 50 ảnh, khách chấm từng ảnh",
        files: [{ name: "yeu-cau-khach-nhat.pdf", hint: "client spec sheet for product cut-out, edge quality examples at 300% zoom" }],
        react: { "👀": ["khoa", "nv01", "nv14"], "😮": ["nv03"] }
      },
      {
        by: "khoa",
        text: "Khách này rất gắt về viền, anh đề xuất đợt thử chỉ cho 3 bạn làm: @{nv01} @{nv03} @{nv14}. Các bạn dùng Pen Tool, **không dùng Magic Wand/Quick Selection** cho cạnh thẳng.",
        gap: 6,
        react: { "👍": ["nv01", "nv14"], "🙏": ["nv03"] },
        thread: [
          { by: "nv14", text: "Cạnh cong như tay cầm ấm nước thì sao anh, pen tool lâu lắm ạ.", gap: 5 },
          { by: "khoa", text: "Vẫn pen tool em, đặt ít điểm neo thôi. Tóc, lông, vải mới dùng Select and Mask.", gap: 3 },
          { by: "nv01", text: "Path xong feather bao nhiêu ạ anh?", gap: 4 },
          { by: "khoa", text: "0,3–0,5px thôi, rồi soi trên nền đen và nền đỏ để kiểm viền.", gap: 2 },
          { by: "nv01", text: "Dạ em hiểu ạ.", gap: 1 }
        ]
      },
      { by: "nv03", text: "Em chưa làm khách Nhật bao giờ, hơi run 😅", gap: 8 },
      { by: "khoa", text: "Đợt đầu anh check 100%, cứ làm đúng chuẩn là được.", gap: 2, react: { "❤️": ["nv03"] } },
      { by: "lead1", text: "3 bạn này mình tách khỏi đơn Úc 2 ngày cho tập trung nhé anh.", gap: 4 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-01",
    time: "15:20",
    lines: [
      {
        by: "khoa",
        text: "Đợt thử khách Nhật ngày 1: 20 ảnh, anh trả lại 7 ảnh. Lỗi chính: **viền răng cưa** ở cạnh cong và còn viền trắng 1px ở đáy sản phẩm.",
        files: [
          { name: "cutout-rang-cua-zoom300.png", hint: "300% zoom of product edge with jagged staircase pixels against white" },
          { name: "cutout-vien-sach-zoom300.png", hint: "300% zoom of same edge, smooth anti-aliased clean edge" }
        ],
        react: { "😮": ["nv14", "nv03"], "👀": ["acc1"] }
      },
      {
        by: "nv14",
        text: "Ảnh ấm siêu tốc là của em ạ, em xuất PNG xong resize nên bị răng cưa.",
        gap: 5,
        thread: [
          { by: "khoa", text: "Đúng rồi, resize sau khi cắt sẽ làm hỏng viền. Cắt trên ảnh gốc, resize ở bước cuối với Bicubic Sharper, hoặc làm đúng kích thước khách yêu cầu từ đầu.", gap: 4 },
          { by: "nv14", text: "Dạ em làm lại cả 3 ảnh luôn ạ.", gap: 2 },
          { by: "nv14", text: "Xong rồi anh ơi 🙏", gap: 80 },
          { by: "khoa", text: "Sạch rồi, cạnh cong đẹp 👍", gap: 10 }
        ]
      },
      { by: "nv03", text: "Viền trắng ở đáy là do em giữ phản chiếu nhưng không tách nền ạ.", gap: 6 },
      { by: "khoa", text: "Phản chiếu thì giữ, nhưng nền xung quanh phải 255/255/255 tuyệt đối. Dùng Levels kiểm nền nhé.", gap: 3 },
      { by: "nv01", text: "Em 0 lỗi đợt này anh nhỉ 😁", gap: 4 },
      {
        by: "khoa",
        text: "Ừ @{nv01} làm sạch nhất, mai em chia sẻ cách đặt điểm neo cho 2 bạn kia nhé.",
        gap: 2,
        react: { "👏": ["nv03", "nv14", "lead1"] }
      }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-02",
    time: "14:30",
    lines: [
      {
        by: "khoa",
        text: "**Nhắc nhanh — object removal ảnh exterior**\n\nTuần này có mấy ảnh xoá dây điện, thùng rác, xe đậu trước nhà mà để lại vệt lặp texture (clone stamp lặp y hệt). Dùng Remove Tool/Content-Aware xong phải sửa lại vùng lặp bằng tay.",
        files: [{ name: "object-removal-vet-lap.jpg", hint: "house front with repeated lawn texture pattern after removing a trash bin" }],
        react: { "👀": ["nv02", "nv15", "nv06"] }
      },
      { by: "nv02", text: "Ảnh có cái xe đó là của em ạ 😓 bãi cỏ bị lặp 3 lần thật.", gap: 5 },
      { by: "khoa", text: "@{nv02} em lấy mẫu cỏ ở nhiều vùng khác nhau, xoay và lật patch là hết lặp.", gap: 3, react: { "🙏": ["nv02"] } },
      { by: "nv15", text: "Anh ơi dây điện vắt ngang trời thì khách có muốn xoá hết không ạ?", gap: 6 },
      { by: "khoa", text: "Chỉ xoá khi khách yêu cầu hoặc dây cắt ngang mặt tiền. @{nv15} không chắc thì hỏi trưởng ca nhé.", gap: 2 },
      { by: "nv15", text: "Dạ em nhớ rồi ạ.", gap: 1 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-03",
    time: "10:40",
    lines: [
      {
        by: "khoa",
        text: "## QC tuần 40 (28/9–3/10)\n\n- Ảnh QC: 3.760\n- Fail: 177 → **4,7%** — thấp nhất từ khi đo 🎉\n- HDR nội thất: 5,0% | Exterior/sky: 4,6% | Staging: 4,1% | Cut-out: 5,8% (do đơn thử khách Nhật)\n\nThứ Hai 5/10 chính thức áp dụng checklist v2.",
        files: [{ name: "qc-fail-rate-tuan-40.xlsx", hint: "weekly QC fail rate table and trend chart weeks 35-40" }],
        react: { "🎉": ["boss", "linh", "lead1", "nv04", "nv09", "nv12"], "👏": ["lead2"] },
        thread: [
          { by: "boss", text: "Từ 6,8% xuống 4,7% trong 5 tuần, các em giỏi lắm 👏 Cuối tháng xuống dưới 4% anh mời cả team đi ăn.", gap: 15 },
          { by: "nv09", text: "Ố dè anh hứa rồi nha 😂", gap: 2 },
          { by: "lead1", text: "Ca A nghe rõ rồi ạ 😁", gap: 2 },
          { by: "khoa", text: "Nhận kèo anh ơi 💪", gap: 3 }
        ]
      },
      {
        by: "linh",
        text: "Cut-out 5,8% là do đợt thử nên chị không lo, nhưng phải xuống trước khi khách Nhật ký chính thức nhé @{khoa}.",
        edited: "Cut-out 5,8% là do đợt thử nên chị không lo, nhưng phải xuống dưới 4% trước khi khách Nhật ký chính thức nhé @{khoa}.",
        gap: 10
      },
      { by: "khoa", text: "Dạ chị, tuần sau em check 100% đơn Nhật.", gap: 3 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-05",
    time: "08:30",
    lines: [
      {
        by: "khoa",
        text: "## 📋 QC Checklist v2 — áp dụng từ hôm nay 5/10\n\nBản đầy đủ đính kèm, bản tóm tắt 1 trang đã dán ở từng bàn. Điểm thay đổi chính:\n\n- Mỗi tiêu chí có ảnh **đúng/sai** để so\n- Trời: Hue ban ngày 200–215, twilight chỉ dùng bộ sky-chuan\n- Window pull: cảnh ngoài tối hơn trong phòng ½–1 stop\n- Đường dọc: kiểm bằng lưới, crop sạch viền\n- WB: tường trắng lệch RGB ≤ 5 trên Info panel\n- Staging: bóng đổ theo nguồn sáng chính, có contact shadow\n- Cut-out: zoom 300%, nền 255, không răng cưa\n\nTừ tuần này QC ghi lỗi theo **mã mục** trong checklist (vd: 2.3, 6.1) để thống kê chính xác hơn.",
        files: [{ name: "QC-checklist-v2-chinh-thuc.pdf", hint: "final QC checklist v2, 7 pages with good/bad image pairs and one-page summary" }],
        react: {
          "👍": ["boss", "linh", "lead1", "lead2", "nv01", "nv05", "nv08", "nv10"],
          "🔥": ["nv04", "nv12"],
          "🎉": ["acc1"]
        },
        thread: [
          { by: "nv10", text: "Anh ơi bản tóm tắt có file mềm không ạ, em muốn để trên màn hình phụ.", gap: 12 },
          { by: "khoa", text: "Trang cuối file PDF là bản tóm tắt đó em.", gap: 3 },
          { by: "nv05", text: "Mã mục là ghi vào comment trên task luôn hả anh?", gap: 6 },
          { by: "khoa", text: "Đúng rồi, QC trả lại sẽ comment kiểu `2.3 – halo mái nhà` để em biết ngay mục nào.", gap: 2 },
          { by: "nv05", text: "Dạ tiện quá ạ 👍", gap: 1 }
        ]
      },
      { by: "boss", text: "Làm tốt lắm @{khoa}. Thứ Bảy anh muốn xem fail rate theo mã mục nhé.", gap: 20, react: { "👍": ["khoa"] } },
      { by: "khoa", text: "Dạ thứ Bảy này em gửi anh ạ.", gap: 3 },
      { by: "lead2", text: "Ca B chiều nay mình họp 10 phút đầu ca để đọc checklist cùng nhau.", gap: 5, react: { "👍": ["linh"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-06",
    time: "14:00",
    lines: [
      {
        by: "nv15",
        text: "Anh Khoa ơi mục 1.6 ghi 'không để lộ phản chiếu người chụp', vậy gương to quá xoá không được thì làm sao ạ?",
        thread: [
          { by: "khoa", text: "Xoá không được thì báo trưởng ca để account hỏi khách. Đa số khách đồng ý thay bằng phản chiếu tường đối diện.", gap: 5 },
          {
            by: "nv15",
            text: "Dạ em làm thử bằng cách copy mảng tường bên cạnh, anh xem được không ạ?",
            gap: 25,
            files: [{ name: "phan-chieu-guong-sua.jpg", hint: "bathroom mirror with photographer reflection removed, replaced with wall texture" }]
          },
          { by: "khoa", text: "Được đó em, thêm chút gradient sáng cho giống mặt kính.", gap: 6 },
          { by: "nv15", text: "Dạ em cảm ơn ạ 🙏", gap: 1 }
        ]
      },
      { by: "nv02", text: "Mục 4.2 bóng đổ thì ảnh staging ngoài trời (bàn ghế sân vườn) có áp dụng không anh?", gap: 8 },
      {
        by: "khoa",
        text: "Có em, ngoài trời thì theo hướng mặt trời trong ảnh, bóng sắc hơn trong nhà.",
        edited: "Có em, ngoài trời thì theo hướng mặt trời trong ảnh, bóng sắc và đậm hơn trong nhà. Trời âm u thì chỉ cần contact shadow.",
        gap: 3
      },
      { by: "nv02", text: "Dạ rõ ạ 👍", gap: 2 },
      {
        by: "lead1",
        text: "Hôm nay ca A QC trả 11 ảnh, 6 ảnh là mục 2.3 halo mái nhà. Mai mình ôn lại phần này 15 phút đầu ca.",
        gap: 30,
        react: { "👍": ["khoa"] }
      },
      { by: "khoa", text: "Ok, anh gửi lại ảnh mẫu halo cho các bạn xem trước nhé.", gap: 4 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-07",
    time: "16:00",
    lines: [
      {
        by: "khoa",
        text: "Đợt thử khách Nhật ngày 2: 30 ảnh, chỉ trả 2 ảnh 👏 Cảm ơn @{nv01} đã hướng dẫn 2 bạn cách đặt điểm neo.",
        react: { "👏": ["nv01", "nv03", "nv14", "acc1", "lead1"], "🎉": ["linh"] }
      },
      { by: "acc1", text: "Đã gửi khách đợt 1 + 2, tổng 50 ảnh, khách sẽ phản hồi trong 2 ngày ạ.", gap: 6 },
      {
        by: "nv03",
        text: "2 ảnh lỗi là gì anh ơi, của em hay của @{nv14} ạ?",
        gap: 4,
        thread: [
          { by: "khoa", text: "1 ảnh của em: chai thuỷ tinh trong suốt, nền phía sau lộ qua thân chai vẫn còn xám. 1 ảnh của @{nv14}: dây điện bị cắt mất một đoạn.", gap: 3 },
          { by: "nv03", text: "Dạ vật trong suốt khó quá, em làm lại bằng cách giữ độ trong rồi thay nền trắng phía sau ạ.", gap: 4 },
          { by: "khoa", text: "Đúng hướng, lớp kính giữ khoảng 20–30% để nhìn vẫn ra thuỷ tinh.", gap: 2 },
          { by: "nv14", text: "Em sót dây điện, em sửa rồi ạ 😓", gap: 9 }
        ]
      },
      { by: "nv06", text: "Anh ơi em cũng muốn học cut-out khách Nhật, đợt sau cho em tham gia được không ạ?", gap: 12 },
      { by: "khoa", text: "Được em, nếu khách ký chính thức thì team mở thêm 3 người. Trưởng ca đang lên danh sách.", gap: 3, react: { "🙏": ["nv06"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-08",
    time: "10:15",
    lines: [
      {
        by: "khoa",
        text: "Nhắc lại **mục 2.3 – halo** vì 3 ngày nay vẫn còn, nhưng giờ ở ảnh day-to-dusk: viền mái nhà sáng xanh trên nền trời cam.",
        files: [{ name: "dusk-halo-mai-before-after.jpg", hint: "day-to-dusk roofline with cyan halo vs fixed version" }],
        react: { "👀": ["nv07", "nv10", "nv12"] }
      },
      {
        by: "khoa",
        text: "Mẹo nhanh: sau khi thay trời, tạo layer chế độ Color, lấy màu trời mới tô nhẹ dọc mép mái với brush 20–30% → hết viền xanh. Đừng dùng Defringe cho ảnh lớn, dễ ăn mất chi tiết ngói.",
        gap: 2,
        react: { "💯": ["lead2", "nv07"], "👍": ["nv10"] }
      },
      { by: "nv07", text: "Cách này nhanh hơn refine edge nhiều ạ, em thử rồi 👍", gap: 15 },
      { by: "nv12", text: "Có cách nào áp dụng cho cả bộ ảnh cùng góc chụp không anh?", gap: 4 },
      { by: "khoa", text: "Cùng góc thì lưu mask mái thành selection rồi load lại cho ảnh sau, chỉnh chút là xong. Nhưng kiểm từng ảnh, đừng batch mù.", gap: 3 },
      { by: "lead2", text: "Ca B chiều nay mình phổ biến mẹo này luôn.", gap: 5 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-09",
    time: "09:20",
    lines: [
      {
        by: "lead1",
        text: "Sáng nay đơn 160 ảnh HDR của agency Úc, QC trả 5 ảnh, 4 ảnh mục 1.2 cửa sổ cháy. @{nv05} @{nv10} hai bạn xem lại giúp mình nhé.",
        react: { "👀": ["nv05", "nv10"] }
      },
      { by: "nv05", text: "Dạ em xem rồi, lại là bộ bracket thiếu frame tối ạ. Em đã báo account hỏi khách.", gap: 6 },
      { by: "acc1", text: "Mình hỏi rồi, khách đồng ý cho thay cảnh ngoài cửa sổ với 4 ảnh này nhé.", gap: 15 },
      {
        by: "khoa",
        text: "Vậy dùng ảnh cảnh vườn cùng giờ chụp, nhớ match ánh sáng và độ mờ (cảnh ngoài hơi mờ vì độ sâu trường ảnh).",
        gap: 3,
        react: { "👍": ["nv05"] }
      },
      { by: "nv10", text: "Em làm 2 ảnh, @{nv05} làm 2 ảnh nha.", gap: 2, react: { "👍": ["nv05"] } },
      { by: "nv05", text: "Ok bạn 👍", gap: 1 },
      { by: "khoa", text: "Xong thì tag @{lead1} check trước khi giao, không cần qua QC lần nữa.", gap: 2 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-09",
    time: "16:45",
    lines: [
      {
        by: "acc1",
        text: "🎉 Khách Nhật phản hồi đợt thử: **48/50 ảnh đạt**, 2 ảnh yêu cầu chỉnh nhẹ (chai thuỷ tinh và cạnh hộp giấy). Khách rất hài lòng về viền, muốn bàn hợp đồng chính thức tuần sau. @{boss} @{linh}",
        react: {
          "🎉": ["linh", "khoa", "nv01", "nv03", "nv14", "lead1", "lead2"],
          "🔥": ["nv04"]
        },
        thread: [
          { by: "boss", text: "Tuyệt vời 👏 Cảm ơn @{khoa} và 3 em @{nv01} @{nv03} @{nv14}. Thứ Hai anh họp với account để chốt.", gap: 11 },
          { by: "nv14", text: "Dạ em cảm ơn anh ạ 🙏", gap: 2 },
          { by: "nv03", text: "Vui quá ạ 😭", gap: 1 },
          { by: "khoa", text: "Cảm ơn anh. Em sẽ viết lại hướng dẫn cut-out riêng cho khách này để mở rộng team.", gap: 4 }
        ]
      },
      {
        by: "khoa",
        text: "2 ảnh khách góp ý anh giao lại cho @{nv03}: chai thuỷ tinh giảm thêm độ xám phía sau, hộp giấy làm sắc cạnh dưới. Sáng mai xong nhé.",
        gap: 8
      },
      { by: "nv03", text: "Dạ sáng mai 9h em gửi ạ.", gap: 2, react: { "👍": ["khoa"] } },
      { by: "linh", text: "Team làm tốt lắm 👏 Chị sẽ ghi nhận vào đánh giá tháng 10.", gap: 5, react: { "❤️": ["nv01", "nv03", "nv14"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-10",
    time: "09:10",
    lines: [
      {
        by: "nv03",
        text: "Anh Khoa ơi 2 ảnh khách Nhật em sửa xong rồi ạ.",
        files: [
          { name: "chai-thuy-tinh-v2.png", hint: "transparent glass bottle cut-out on pure white, subtle transparency" },
          { name: "hop-giay-canh-sac-v2.png", hint: "paper box cut-out with crisp bottom edge on white" }
        ]
      },
      { by: "khoa", text: "Sạch rồi em 👍 @{acc1} gửi khách giúp anh nhé.", gap: 12 },
      { by: "acc1", text: "Đã gửi ạ ✅", gap: 5, react: { "🙏": ["nv03"] } },
      { by: "nv08", text: "Sáng nay có ai check QC giúp em không ạ, em có 30 ảnh staging cần giao trước 12h.", gap: 20 },
      { by: "lead1", text: "Mình check được, đẩy vào folder QC-gap nhé @{nv08}.", gap: 3 },
      { by: "nv08", text: "Dạ em đẩy rồi ạ 🙏", gap: 2 }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-10",
    time: "14:30",
    lines: [
      {
        by: "khoa",
        text: "## QC tuần 41 (5–10/10) — tuần đầu checklist v2\n\n- Ảnh QC: 3.980 (số đến 14:00 hôm nay)\n- Fail: 155 → **3,9%** 🎉 lần đầu xuống dưới 4%\n- Top mã lỗi: 2.3 halo (22%), 1.2 cửa sổ cháy (19%), 4.2 bóng đổ (11%)\n- Cut-out khách Nhật: 2/50 ảnh bị góp ý\n\nBảng chi tiết theo mã mục đính kèm. @{boss} anh xem giúp em, dưới 4% như đã hứa rồi ạ 😁",
        files: [{ name: "qc-fail-rate-tuan-41-theo-ma-muc.xlsx", hint: "QC fail rate week 41 broken down by checklist item code, trend chart weeks 35-41" }],
        react: {
          "🎉": ["linh", "lead1", "lead2", "nv04", "nv09", "nv12", "nv01"],
          "👏": ["acc1", "nv06"],
          "😂": ["nv02"]
        },
        thread: [
          { by: "linh", text: "Xuất sắc 👏 Chị nhắc anh vụ đi ăn liền đây 😄", gap: 6 },
          { by: "nv09", text: "Hóng kèo của anh @{boss} ạ 😂", gap: 3 },
          { by: "lead1", text: "Ca A tuần này 3,4% nha anh Khoa 😎", gap: 4 },
          { by: "khoa", text: "Ca A đúng là đỉnh tuần này, ca B 4,5% vì nhận nhiều đơn staging.", gap: 3 },
          { by: "lead2", text: "Tuần sau ca B gỡ lại 💪", gap: 2 }
        ]
      },
      { by: "nv12", text: "Anh ơi số này chưa tính ca chiều với ca đêm hôm nay đúng không ạ?", gap: 10 },
      { by: "khoa", text: "Đúng em, tối nay anh cập nhật số cuối, chênh không nhiều.", gap: 3 },
      { by: "nv04", text: "Tuần này em vẫn 0 lỗi nha anh Khoa 😁", gap: 7, react: { "👏": ["khoa", "nv09"] } }
    ]
  },
  {
    where: { channel: "qc-chat-luong" },
    date: "2026-10-10",
    time: "17:20",
    lines: [
      {
        by: "khoa",
        text: "📌 **Kế hoạch QC tuần 42 (12–17/10)**\n\n- Thứ Hai: mở rộng team cut-out khách Nhật thêm 3 bạn: @{nv06} @{nv08} @{nv12} — @{nv01} kèm 2 buổi\n- Ôn lại mục 2.3 halo cho cả 2 ca\n- Bắt đầu soạn phần checklist cho 6 bạn retoucher mới vào tháng 10\n\n@{boss} @{linh} anh chị xem có cần điều chỉnh gì không ạ. @{lead1} @{lead2} sắp lịch giúp em nhé.",
        react: { "👍": ["lead1", "lead2", "nv06", "nv08"], "🎉": ["nv12"] }
      },
      { by: "nv06", text: "Yeahh em được học rồi 🎉 cảm ơn anh Khoa ạ.", gap: 4 },
      { by: "nv12", text: "Dạ em sẵn sàng ạ.", gap: 2 },
      { by: "lead1", text: "Buổi kèm sáng thứ Hai 8:00–9:30 được không anh @{khoa}?", gap: 3 },
      { by: "khoa", text: "Được, phòng họp nhỏ nhé.", gap: 2 },
      { by: "nv01", text: "Dạ em chuẩn bị file mẫu điểm neo cho các bạn ạ.", gap: 3, react: { "❤️": ["khoa", "nv06"] } },
      {
        by: "lead2",
        text: "@{boss} anh ơi tuần sau ca B xin thêm 1 màn hình chuẩn màu cho máy QC ca chiều, màn cũ lệch màu khá nhiều rồi ạ.",
        gap: 6,
        react: { "👀": ["khoa"] }
      },
      { by: "khoa", text: "Em xác nhận, máy đó đo lệch Delta E khá cao rồi anh ạ.", gap: 2 }
    ]
  },

  // ─────────────────────────── #leader-san-xuat (private) ───────────────────────────
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-08-25",
    time: "16:30",
    lines: [
      {
        by: "linh",
        text: "Chị tạo kênh riêng cho nhóm leader sản xuất: anh, chị, 2 trưởng ca và anh Khoa. Chuyện nhân sự, xếp ca, đánh giá sẽ trao đổi ở đây, không đưa ra kênh chung nhé.",
        react: { "👍": ["lead1", "lead2", "khoa"] }
      },
      {
        by: "boss",
        text: "Ok. Mỗi thứ Sáu các em gửi KPI tuần vào đây: sản lượng, tỉ lệ đúng hạn, fail rate, nhân sự nghỉ.",
        gap: 5,
        react: { "✅": ["linh"] }
      },
      { by: "lead1", text: "Dạ anh. Mẫu báo cáo dùng chung 1 file hay mỗi ca 1 file ạ?", gap: 3 },
      { by: "linh", text: "Dùng chung 1 file, mỗi ca 1 sheet. Chị gửi mẫu ngay.", gap: 2 },
      {
        by: "linh",
        text: "Mẫu đây nhé.",
        gap: 4,
        files: [{ name: "mau-kpi-tuan-san-xuat.xlsx", hint: "weekly production KPI template, one sheet per shift" }]
      },
      { by: "lead2", text: "Nhận ạ 👍", gap: 1 },
      { by: "khoa", text: "Em sẽ điền cột fail rate cho cả 2 ca vào chiều thứ Sáu.", gap: 3 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-08-27",
    time: "17:00",
    lines: [
      {
        by: "linh",
        text: "Lễ 2/9 năm nay nghỉ thứ Ba–thứ Tư (1–2/9). Khách Úc vẫn gửi đơn nên cần ca trực. @{lead1} @{lead2} mỗi ca dự kiến bao nhiêu người?"
      },
      { by: "lead1", text: "Theo lịch account gửi thì mỗi ngày khoảng 200 ảnh. Ca A em đề xuất 3 bạn trực, làm 8:00–16:00.", gap: 6 },
      { by: "lead2", text: "Ca B 2 bạn, 13:00–21:00. Em hỏi trước rồi, có 4 bạn tình nguyện, ưu tiên các bạn không về quê.", gap: 4 },
      {
        by: "boss",
        text: "Trực lễ tính lương ngày lễ theo luật, thêm tiền ăn. Không ép ai, ưu tiên tình nguyện.",
        gap: 5,
        react: { "👍": ["linh", "lead1", "lead2"] },
        thread: [
          { by: "linh", text: "Chị báo bên hành chính làm phụ lục chấm công ngày lễ nhé.", gap: 4 },
          { by: "lead2", text: "Dạ, em chốt danh sách trước thứ Hai ạ.", gap: 3 },
          { by: "boss", text: "Leader có ai trực không?", gap: 5 },
          { by: "lead1", text: "Em trực ngày 1/9, @{lead2} trực 2/9 ạ.", gap: 2 },
          { by: "boss", text: "Tốt.", gap: 1 }
        ]
      },
      { by: "khoa", text: "QC em trực online buổi sáng cả 2 ngày, ảnh gấp thì trưởng ca check giúp.", gap: 7 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-08-31",
    time: "17:15",
    lines: [
      {
        by: "lead2",
        text: "Chốt ca trực lễ:\n- 1/9: 3 bạn ca A + @{lead1}\n- 2/9: 2 bạn ca B + 1 bạn ca A + em\n\nDanh sách tên em đã gửi chị Linh để chấm công.",
        react: { "✅": ["linh"], "👍": ["boss", "khoa"] }
      },
      { by: "linh", text: "Nhận rồi nha. Các em trực nhớ đặt cơm trước nhé.", gap: 4 },
      { by: "boss", text: "Cảm ơn các em. Nghỉ lễ vui vẻ.", gap: 6, react: { "❤️": ["lead1", "lead2"] } }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-04",
    time: "16:40",
    lines: [
      {
        by: "linh",
        text: "KPI tuần 36 (tuần lễ) cả 2 ca đã cập nhật file.",
        files: [{ name: "kpi-san-xuat-tuan-36.xlsx", hint: "weekly production KPI week 36, output per shift, on-time rate, fail rate" }]
      },
      {
        by: "linh",
        text: "Tóm tắt:\n- Sản lượng: 2.610 ảnh (4 ngày làm việc + 2 ngày trực)\n- Đúng hạn: 97,8%\n- Fail rate: 6,1%\n- Nghỉ phép: 2 người (đã duyệt trước)",
        gap: 1
      },
      {
        by: "boss",
        text: "Đúng hạn 97,8% là ổn. 2,2% trễ là đơn nào em?",
        gap: 9,
        thread: [
          { by: "lead1", text: "Dạ là 1 đơn virtual staging 25 ảnh, khách gửi thêm yêu cầu đổi nội thất giữa chừng nên trễ 3 tiếng ạ.", gap: 4 },
          { by: "boss", text: "Vậy không tính lỗi mình. Nhưng account phải ghi lại thay đổi yêu cầu để sau này đối chiếu.", gap: 3 },
          { by: "linh", text: "Chị nhắc bên account ghi vào comment task nhé anh.", gap: 2 }
        ]
      },
      { by: "khoa", text: "Fail rate ca B hơi cao do ảnh ca trực, tuần sau em theo sát.", gap: 6 },
      { by: "lead2", text: "Dạ ca B nhận ạ.", gap: 2 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-08",
    time: "10:00",
    lines: [
      {
        by: "linh",
        text: "Account báo đợt **14–19/9** các agency Úc vào mùa xuân, dự kiến **gấp đôi** khối lượng: khoảng 1.000–1.200 ảnh/ngày. Công suất hiện tại ~650 ảnh/ngày. Cần phương án.",
        react: { "😮": ["lead1", "lead2"], "👀": ["khoa"] }
      },
      { by: "lead1", text: "Ca A tăng ca thêm 2 tiếng thì được khoảng +120 ảnh/ngày.", gap: 5 },
      {
        by: "lead2",
        text: "Ca B kéo đến 23:00, cộng thêm ca đêm 22:00–6:00 với 4–5 bạn thì đủ ạ.",
        edited: "Ca B kéo đến 23:00, cộng thêm ca đêm 22:00–6:00 với 5 bạn thì đủ ạ (khoảng +300 ảnh/đêm).",
        gap: 3
      },
      { by: "khoa", text: "QC không thể check 100% với khối lượng này. Em đề xuất check 100% sky và window pull, còn lại check mẫu 30%.", gap: 4 },
      {
        by: "boss",
        text: "Đồng ý mở ca đêm. Điều kiện:\n- Tự nguyện, không ai làm quá 6 ngày liên tiếp\n- Công ty lo taxi về và ăn khuya\n- Phải có 1 leader online trong ca đêm",
        gap: 6,
        react: { "👍": ["linh", "lead1", "lead2", "khoa"] },
        thread: [
          { by: "lead2", text: "Ca đêm em nhận làm leader 3 đêm đầu ạ.", gap: 3 },
          { by: "lead1", text: "3 đêm sau em thay ạ.", gap: 2 },
          { by: "boss", text: "Leader trực đêm thì hôm sau nghỉ sáng, không cần lên văn phòng.", gap: 4 },
          { by: "linh", text: "Chị làm phiếu tăng ca và nhờ hành chính đặt taxi.", gap: 3 }
        ]
      },
      { by: "linh", text: "@{lead1} @{lead2} thứ Năm gửi chị lịch ca đêm dự kiến nhé.", gap: 8 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-10",
    time: "17:30",
    lines: [
      {
        by: "lead2",
        text: "Lịch ca đêm 14–19/9 dự kiến:",
        files: [{ name: "lich-ca-dem-14-19-9.xlsx", hint: "night shift roster Sep 14-19, 5 retouchers per night with leader on duty" }]
      },
      {
        by: "lead2",
        text: "Mỗi đêm 5 bạn, tổng 11 bạn luân phiên, không ai quá 3 đêm. Vướng 1 chuyện: 1 bạn ca B đã xin nghỉ cưới 15–17/9 từ tháng trước.",
        gap: 1
      },
      { by: "boss", text: "Nghỉ cưới thì giữ nguyên, không bắt dời. Thiếu người thì tính cách khác.", gap: 5, react: { "❤️": ["lead2"] } },
      { by: "lead1", text: "Ca A có 2 bạn xin chuyển sang ca đêm vì muốn tăng thu nhập, em đề xuất bù vào chỗ đó ạ.", gap: 4 },
      { by: "linh", text: "Ok, nhưng 2 bạn đó chuyển ca thì ca A buổi sáng hụt, @{lead1} xoay được không?", gap: 3 },
      { by: "lead1", text: "Dạ được chị, ca A sáng tăng ca thêm 1 tiếng là bù.", gap: 2 },
      {
        by: "khoa",
        text: "Lưu ý thêm: Lộc nghỉ việc từ 12/9, ca A mất 1 người cứng tay HDR.",
        gap: 4,
        thread: [
          { by: "boss", text: "Đúng rồi. Tuần đó anh không muốn tuyển gấp, cứ xoay nội bộ. Sau đợt này lên kế hoạch tuyển.", gap: 3 },
          { by: "linh", text: "Chị đang soạn kế hoạch tuyển 6 retoucher cho tháng 10, tuần sau gửi anh duyệt.", gap: 3 },
          { by: "boss", text: "Ok.", gap: 1 }
        ]
      },
      {
        by: "boss",
        text: "Lịch ca đêm anh duyệt. Taxi và ăn khuya @{linh} lo giúp anh nhé.",
        gap: 6,
        react: { "✅": ["linh", "lead2"] }
      }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-12",
    time: "10:30",
    lines: [
      {
        by: "lead1",
        text: "Hôm nay ngày cuối của Lộc. 2 job HDR dở dang đã bàn giao cho 2 bạn ca A, file nguồn để đúng folder trên NAS."
      },
      { by: "linh", text: "Bàn giao xong nhớ nhắc hành chính thu hồi tài khoản và máy nhé.", gap: 4, react: { "👍": ["lead1"] } },
      { by: "boss", text: "Hôm qua tiệc chia tay vui. Lộc làm ở đây lâu, có gì cần xác nhận kinh nghiệm thì các em báo anh.", gap: 8, react: { "❤️": ["linh", "lead1", "khoa"] } },
      { by: "khoa", text: "Bộ action HDR của Lộc em đã xin giữ lại cho team dùng tiếp ạ.", gap: 3, react: { "👏": ["lead1"] } }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-15",
    time: "06:15",
    lines: [
      {
        by: "lead2",
        text: "Báo cáo đêm 1 (14/9): ca đêm 5 bạn làm 312 ảnh, xong toàn bộ đơn deadline sáng bên Úc. Không có sự cố.",
        react: { "👏": ["boss", "linh", "khoa"] }
      },
      { by: "boss", text: "Cảm ơn em. Về nghỉ đi, trưa ngủ dậy rồi tính tiếp.", gap: 27 },
      { by: "linh", text: "Vất vả rồi em 🙏 Taxi về có ổn không?", gap: 70 },
      { by: "lead2", text: "Dạ ổn chị, tài xế đúng giờ ạ.", gap: 5 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-15",
    time: "22:35",
    lines: [
      {
        by: "lead2",
        text: "Đêm 2 bắt đầu. 1 bạn bị sốt nhẹ từ chiều, em cho về rồi. Còn 4 bạn, em ngồi làm cùng để bù."
      },
      { by: "boss", text: "Cho bạn ấy về là đúng, đừng cố. Mai bạn ấy nghỉ luôn cũng được.", gap: 12, react: { "🙏": ["lead2"] } },
      { by: "lead2", text: "Dạ em báo bạn ấy rồi ạ.", gap: 3 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-17",
    time: "13:30",
    lines: [
      {
        by: "khoa",
        text: "Báo cáo vụ khách Úc complain màu trời (15/9): nguyên nhân là 1 bạn ca B dùng preset trời cũ có saturation cao, không theo bộ trời mới em gửi. 12 ảnh đã sửa xong trong đêm."
      },
      { by: "linh", text: "Bạn đó chưa biết bộ trời mới hay biết mà vẫn dùng bộ cũ?", gap: 5 },
      { by: "lead2", text: "Dạ bạn ấy biết nhưng bộ cũ đã cài sẵn thành action nên quen tay ạ. Em đã nói chuyện riêng rồi, bạn nhận lỗi.", gap: 4 },
      {
        by: "boss",
        text: "Không phạt. Lỗi do quy trình là chính: có bộ mới thì phải gỡ bộ cũ khỏi máy. @{khoa} làm việc đó cho tất cả máy.",
        gap: 6,
        react: { "👍": ["khoa", "lead2"], "💯": ["linh"] },
        thread: [
          { by: "khoa", text: "Dạ em cùng anh Minh gỡ preset cũ trên tất cả máy cuối tuần này ạ.", gap: 3 },
          { by: "linh", text: "Sau đợt cao điểm chị muốn có 1 buổi đào tạo lại chuẩn màu trời cho cả 2 ca.", gap: 4 },
          { by: "khoa", text: "Dạ em lên lịch thứ Ba 22/9 ạ.", gap: 2 }
        ]
      },
      { by: "lead2", text: "Em cảm ơn anh, bạn ấy đang rất lo.", gap: 5 },
      { by: "boss", text: "Nói bạn ấy yên tâm làm, sửa nhanh trong đêm là tốt rồi.", gap: 3, react: { "❤️": ["lead2", "linh"] } }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-19",
    time: "18:00",
    lines: [
      {
        by: "linh",
        text: "Tổng kết đợt cao điểm 14–19/9:\n- Sản lượng: 6.120 ảnh (tuần thường ~3.500)\n- Đúng hạn: 99,1%\n- Fail rate: 9,2%\n- Khiếu nại khách: 2 (màu trời, window pull) — đều xử lý trong ngày\n- Ca đêm: 6 đêm, 11 bạn tham gia",
        react: { "👏": ["boss", "lead1", "lead2", "khoa"], "🔥": ["lead1"] }
      },
      {
        by: "boss",
        text: "Cả team làm rất tốt. Anh muốn **thưởng nóng** cho đợt này. Các em đề xuất danh sách và mức theo tiêu chí, gửi trước thứ Ba 22/9.",
        gap: 8,
        react: { "🎉": ["lead1", "lead2", "khoa", "linh"] },
        thread: [
          { by: "lead1", text: "Tiêu chí em đề xuất: số ca đêm tham gia, sản lượng, và fail rate dưới 6% ạ.", gap: 5 },
          { by: "khoa", text: "Em đề nghị thêm: ai sửa ảnh khiếu nại ngoài giờ cũng được cộng.", gap: 3 },
          { by: "linh", text: "Chị gom lại thành 3 mức A/B/C nhé, số tiền từng mức anh quyết.", gap: 4 },
          { by: "boss", text: "Ok, làm nhanh để trả cùng lương tháng 9.", gap: 3 }
        ]
      },
      { by: "lead2", text: "Em cảm ơn anh, các bạn ca đêm sẽ vui lắm ạ 😄", gap: 4 },
      { by: "khoa", text: "Fail rate cao là do em chủ động giảm check, em sẽ có phương án cho mùa cao điểm sau.", gap: 6 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-22",
    time: "16:00",
    lines: [
      {
        by: "linh",
        text: "Danh sách đề xuất thưởng nóng đợt 14–19/9 đã gom từ 2 ca:",
        files: [{ name: "de-xuat-thuong-nong-dot-14-19-9.xlsx", hint: "bonus proposal grouped into levels A/B/C with criteria columns" }]
      },
      {
        by: "linh",
        text: "- Mức A: 5 bạn (≥ 3 ca đêm, fail < 5%)\n- Mức B: 9 bạn\n- Mức C: 6 bạn\n- Leader: 2 trưởng ca + anh Khoa (anh quyết)\n\nTổng 23 người.",
        gap: 1
      },
      {
        by: "boss",
        text: "Mức A, B, C anh duyệt theo đề xuất. Leader nhận mức A. Trả cùng lương tháng 9 ngày 5/10.",
        gap: 15,
        react: { "🎉": ["lead1", "lead2", "khoa"], "🙏": ["linh"] },
        thread: [
          { by: "lead1", text: "Em cảm ơn anh ạ 🙏", gap: 2 },
          { by: "khoa", text: "Cảm ơn anh, em sẽ báo team QC.", gap: 3 },
          { by: "boss", text: "Chưa thông báo rộng nhé, để chị Linh gửi thông báo chính thức.", gap: 2 },
          { by: "linh", text: "Chị đăng thông báo vào thứ Sáu.", gap: 3 }
        ]
      },
      { by: "lead2", text: "Có 1 bạn ca B làm 2 đêm nhưng bị sốt về sớm đêm 15/9, em xếp mức C, anh chị thấy ổn không ạ?", gap: 6 },
      { by: "boss", text: "Cho mức B. Bạn ấy ốm mà vẫn cố, không trừ.", gap: 3, react: { "❤️": ["lead2", "linh"] } },
      {
        by: "linh",
        text: "Ok chị sửa file.",
        edited: "Ok chị sửa file rồi, giờ mức B có 10 bạn, mức C còn 5 bạn.",
        gap: 2
      }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-24",
    time: "17:20",
    lines: [
      {
        by: "lead2",
        text: "Em xin ý kiến 1 việc: 2 bạn ca B phản ánh chia job không công bằng, cho rằng 1 bạn khác hay được giao job staging (điểm sản lượng cao hơn), còn mình toàn HDR."
      },
      { by: "linh", text: "Thực tế có vậy không em?", gap: 4 },
      {
        by: "lead2",
        text: "Em xem lại thì đúng là tuần trước bạn đó nhận 70% job staging của ca B, do làm nhanh và ít lỗi nên em hay giao. Em chưa tính đến cảm nhận của các bạn khác.",
        gap: 5
      },
      { by: "khoa", text: "Về chất lượng thì bạn đó staging tốt nhất ca B thật. Nhưng không cho người khác làm thì không ai lên tay được.", gap: 4 },
      {
        by: "boss",
        text: "Hai ý đều đúng. Anh đề xuất:\n1. Job staging chia theo vòng, ai đạt chuẩn QC staging thì vào vòng\n2. Ai chưa đạt thì được kèm, đạt rồi thì vào\n3. Trên Nesso Work ghi rõ ai nhận job gì để mọi người tự xem\n\nMinh bạch là hết thắc mắc.",
        gap: 7,
        react: { "💯": ["linh", "khoa"], "👍": ["lead2", "lead1"] },
        thread: [
          { by: "lead2", text: "Dạ em áp dụng từ tuần sau ạ. Em sẽ nói chuyện với 2 bạn phản ánh trước.", gap: 4 },
          { by: "lead1", text: "Ca A em cũng áp dụng luôn cho đồng bộ ạ.", gap: 3 },
          { by: "khoa", text: "Em gửi danh sách ai đã đạt chuẩn staging theo số liệu QC cho 2 trưởng ca.", gap: 5 }
        ]
      },
      { by: "linh", text: "Cảm ơn @{lead2} đã báo sớm, mấy chuyện này để lâu là mất đoàn kết.", gap: 6, react: { "🙏": ["lead2"] } }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-09-29",
    time: "16:30",
    lines: [
      {
        by: "lead2",
        text: "Hai bạn thử việc nhóm B vào ngày 11/8 sẽ hết 2 tháng thử việc vào **10/10**. Em gửi đánh giá sơ bộ:",
        files: [{ name: "danh-gia-thu-viec-nhom-b.docx", hint: "probation evaluation form for two retouchers, scores on quality, speed, attitude" }]
      },
      {
        by: "lead2",
        text: "- **Bạn thứ nhất:** tay nghề HDR tốt, fail rate tháng 9 là 4,2%, đúng giờ, tham gia 2 ca đêm. Đề xuất ký chính thức.\n- **Bạn thứ hai:** chăm chỉ, thái độ tốt, nhưng tốc độ còn chậm (~70% định mức) và fail rate 7,8%. Đề xuất gia hạn thử việc 1 tháng hoặc ký kèm kế hoạch kèm cặp.",
        gap: 2
      },
      { by: "khoa", text: "Số liệu QC em xác nhận đúng. Bạn thứ hai lỗi chủ yếu là WB và halo, đều sửa được nếu kèm kỹ. Tuần gần đây đã giảm còn 5,5%.", gap: 6 },
      { by: "linh", text: "Chị nghiêng về ký chính thức cả 2, bạn thứ hai kèm kế hoạch 30 ngày có mục tiêu rõ.", gap: 5 },
      {
        by: "boss",
        text: "Bạn thứ nhất anh duyệt ký chính thức. Bạn thứ hai anh cần xem thêm số tuần 40–41 rồi quyết. @{lead2} gửi anh trước 10/10.",
        gap: 8,
        thread: [
          { by: "lead2", text: "Dạ em gửi anh chiều thứ Sáu 9/10 ạ.", gap: 3 },
          { by: "khoa", text: "Em tách riêng số liệu của bạn ấy trong báo cáo QC tuần 40 và 41.", gap: 4 },
          { by: "boss", text: "Ok.", gap: 1 }
        ]
      }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-10-01",
    time: "17:00",
    lines: [
      {
        by: "linh",
        text: "Kế hoạch nhận **6 retoucher mới** tháng 10 (anh đã duyệt chỉ tiêu):\n- Đợt 1: 3 bạn vào ngày 12/10\n- Đợt 2: 3 bạn vào ngày 19/10\n- Đào tạo 2 tuần: tuần 1 lý thuyết + bài tập, tuần 2 làm job thật có kèm\n\nCần chuẩn bị: máy, tài khoản, mentor, giáo trình.",
        files: [{ name: "ke-hoach-onboarding-6-retoucher-thang-10.pdf", hint: "onboarding plan for 6 new retouchers, 2-week training timeline" }],
        react: { "👀": ["lead1", "lead2", "khoa"] }
      },
      { by: "lead1", text: "Ca A nhận 3 bạn đợt 1, em đề xuất mỗi bạn mới có 1 buddy là người cứng tay.", gap: 5 },
      { by: "lead2", text: "Ca B nhận đợt 2. Ca B đang làm staging nhiều nên cần bạn có nền Photoshop tốt.", gap: 4 },
      { by: "khoa", text: "Em chuẩn bị bộ bài test và giáo trình rút gọn theo checklist v2. Buổi đầu em dạy chuẩn QC.", gap: 3 },
      {
        by: "boss",
        text: "Máy móc đủ chưa @{linh}?",
        gap: 6,
        thread: [
          { by: "linh", text: "Hiện còn 2 máy trống, cần mua thêm 4. Anh Minh đã báo giá, chị gửi anh trong nhóm tài chính.", gap: 3 },
          { by: "boss", text: "Ok, duyệt bên đó. Máy phải có màn hình chuẩn màu, không mua loại rẻ.", gap: 4 },
          { by: "linh", text: "Dạ chị đã dặn anh Minh rồi.", gap: 2 }
        ]
      },
      {
        by: "boss",
        text: "Buddy thì cộng điểm đánh giá cho các em đi kèm. Đào tạo người mới là việc chính của leader, không phải làm thêm.",
        gap: 8,
        react: { "👍": ["lead1", "lead2", "linh"] }
      }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-10-03",
    time: "11:30",
    lines: [
      {
        by: "lead1",
        text: "KPI tuần 40 em đã điền. Tóm tắt nhanh: sản lượng 3.760 ảnh, đúng hạn 99,4%, fail 4,7%.",
        files: [{ name: "kpi-san-xuat-tuan-40.xlsx", hint: "weekly production KPI week 40 per shift" }],
        react: { "👏": ["boss", "khoa"] }
      },
      { by: "lead1", text: "Ơ em gửi nhầm file tuần 39, để em gửi lại.", gap: 2, deleted: true },
      { by: "lead1", text: "Đơn xin nghỉ phép tháng 10: ca A có 3 bạn xin nghỉ quanh 20/10, ca B 2 bạn. Em gom lại để không trùng ngày.", gap: 4 },
      { by: "linh", text: "Cuối tháng 10 khách Úc vẫn đông, mỗi ngày tối đa 2 người nghỉ cho cả xưởng nhé.", gap: 5 },
      { by: "lead2", text: "Dạ, em đã sắp ca B không trùng với ca A ạ.", gap: 3 },
      { by: "boss", text: "Nhớ là đợt 2 người mới vào 19/10, tuần đó leader không nghỉ nhé.", gap: 6 },
      { by: "lead2", text: "Dạ rõ ạ.", gap: 1 }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-10-06",
    time: "08:40",
    lines: [
      {
        by: "linh",
        text: "Chúc mừng sinh nhật @{lead1} 🎂 Tuổi mới nhiều sức khoẻ, ca A luôn đúng hạn nhé!",
        react: { "🎉": ["boss", "lead2", "khoa"], "❤️": ["lead1"] }
      },
      { by: "boss", text: "Happy birthday em 🎉 Chiều nay anh gửi bánh xuống ca A.", gap: 6, react: { "❤️": ["lead1"], "😂": ["lead2"] } },
      { by: "lead1", text: "Em cảm ơn anh chị nhiều ạ 🥰", gap: 3 },
      { by: "khoa", text: "Chúc mừng sinh nhật nhé 🎂", gap: 2 },
      { by: "lead2", text: "HPBD đồng nghiệp ca A 🎉", gap: 2 },
      {
        by: "khoa",
        text: "Về khách Nhật: đợt thử 50 ảnh đang chạy với 3 bạn, ngày 1 khá ổn sau khi sửa. Nếu khách ký chính thức, dự kiến 300–400 ảnh/tuần, cần **6 người** chuyên cut-out.",
        gap: 40
      },
      { by: "lead1", text: "Ca A có thể để 3 bạn làm chuyên, nhưng sẽ hụt HDR mùa Úc.", gap: 4 },
      {
        by: "boss",
        text: "Không rút hết người giỏi HDR. Anh đề xuất: 3 bạn hiện tại giữ, thêm 3 bạn đang muốn học, và người mới đợt 1 ai có nền cut-out thì đào tạo theo hướng này.",
        gap: 6,
        react: { "👍": ["khoa", "lead1", "linh"] },
        thread: [
          { by: "linh", text: "Trong 3 bạn mới đợt 1 có 1 bạn từng làm cut-out e-commerce 2 năm, khá phù hợp.", gap: 4 },
          { by: "khoa", text: "Vậy em ưu tiên đào tạo bạn đó theo chuẩn khách Nhật ngay tuần đầu.", gap: 3 },
          { by: "lead2", text: "Ca B có 1 bạn xin học cut-out, em giới thiệu thêm nhé anh Khoa.", gap: 5 },
          { by: "khoa", text: "Ok, nhắn riêng cho anh nhé.", gap: 2 }
        ]
      }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-10-07",
    time: "17:10",
    lines: [
      {
        by: "linh",
        text: "Account dự báo tháng 10–11 khách Úc vẫn cao, trung bình 750–850 ảnh/ngày. Hiện mình làm 650–700/ngày. Ca đêm có cần duy trì không?",
        edited: "Account dự báo tháng 10–11 khách Úc vẫn cao, trung bình 750–850 ảnh/ngày (cao điểm có ngày 1.000). Hiện mình làm 650–700/ngày. Ca đêm có cần duy trì không?"
      },
      { by: "lead2", text: "Em đề xuất duy trì ca đêm 3 đêm/tuần (T2, T4, T6) với 4 bạn, tới khi người mới lên tay.", gap: 5 },
      { by: "lead1", text: "Đồng ý. Cuối tháng 10 người mới lên được khoảng 50% định mức là đỡ.", gap: 3 },
      {
        by: "boss",
        text: "Ok duy trì ca đêm 3 đêm/tuần đến hết tháng 11. Vẫn tự nguyện và có taxi. Leader không trực đêm quá 2 lần/tuần.",
        gap: 7,
        react: { "👍": ["linh", "lead1", "lead2"] }
      },
      {
        by: "khoa",
        text: "QC ca đêm em đề xuất cho 1 bạn QC có kinh nghiệm trực cùng, không để lọt lỗi như đợt 14–19/9.",
        gap: 4,
        thread: [
          { by: "boss", text: "Hợp lý. Ai?", gap: 3 },
          { by: "khoa", text: "Em đề xuất bạn đã 0 lỗi 4 tuần liền ở ca A, bạn ấy cũng muốn học QC.", gap: 3 },
          { by: "lead1", text: "Em đồng ý, nhưng ca A ban ngày cần người thay.", gap: 4 },
          { by: "linh", text: "Lấy từ đợt người mới nhé, tháng 11 sẽ đủ.", gap: 3 },
          { by: "boss", text: "Chốt vậy.", gap: 2 }
        ]
      }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-10-09",
    time: "17:30",
    lines: [
      {
        by: "lead2",
        text: "Số tuần 40–41 của bạn thử việc thứ hai như anh yêu cầu: fail rate tuần 40 là 4,9%, tuần 41 (đến hôm nay) 4,1%. Tốc độ lên ~85% định mức.",
        files: [{ name: "so-lieu-thu-viec-ban-2.xlsx", hint: "probation retoucher weekly fail rate and speed, weeks 37-41" }],
        react: { "👀": ["boss"], "👏": ["khoa", "linh"] }
      },
      { by: "khoa", text: "Tiến bộ rõ, đặc biệt WB gần như không còn lỗi.", gap: 4 },
      {
        by: "linh",
        text: "Tuyển dụng cập nhật: 6 vị trí đã có **4 bạn nhận offer**, 2 bạn còn lại phỏng vấn vòng 2 thứ Hai. @{boss} anh có muốn ngồi vòng 2 không ạ?",
        gap: 6,
        thread: [
          { by: "boss", text: "Có, xếp anh 10:00 thứ Hai.", gap: 9 },
          { by: "linh", text: "Dạ chị đặt phòng họp nhỏ ạ.", gap: 2 },
          { by: "khoa", text: "Bài test thực hành vòng 2 em gửi chị tối nay nhé.", gap: 4 },
          { by: "linh", text: "Ok em.", gap: 1 }
        ]
      },
      { by: "lead1", text: "KPI tuần 41 đến chiều nay: đúng hạn 99,6%, fail 3,9%. Mai chốt số cuối.", gap: 5, react: { "🔥": ["linh"] } },
      { by: "boss", text: "Tuần này rất tốt. Để anh xem kỹ số thử việc rồi trả lời.", gap: 12, react: { "🙏": ["lead2"] } }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-10-10",
    time: "15:10",
    lines: [
      {
        by: "lead2",
        text: "@{boss} hôm nay là ngày cuối thử việc của 2 bạn nhóm B. Bạn thứ nhất anh đã duyệt, bạn thứ hai em đề xuất **ký chính thức kèm kế hoạch kèm cặp 30 ngày** theo số liệu hôm qua. Anh duyệt giúp em để thứ Hai hành chính làm hợp đồng ạ.",
        react: { "👍": ["linh", "khoa"] }
      },
      { by: "linh", text: "Chị đồng ý với đề xuất của @{lead2}. Hồ sơ chị để trên task đánh giá thử việc rồi nhé @{boss}.", gap: 8 },
      { by: "khoa", text: "Em xác nhận số liệu QC, 4 tuần gần đây đều giảm.", gap: 4 },
      {
        by: "lead1",
        text: "Ca A sẵn sàng nhận 3 bạn mới thứ Hai, đã cài xong 2 máy, 1 máy chờ màn hình.",
        gap: 15,
        thread: [
          { by: "linh", text: "Màn hình về chiều thứ Hai, anh Minh lắp luôn.", gap: 5 },
          { by: "lead1", text: "Dạ vậy sáng thứ Hai bạn thứ 3 học lý thuyết với anh Khoa trước.", gap: 3 },
          { by: "khoa", text: "Ok, 8:00 phòng họp nhỏ.", gap: 2 }
        ]
      }
    ]
  },
  {
    where: { channel: "leader-san-xuat" },
    date: "2026-10-10",
    time: "17:45",
    lines: [
      {
        by: "lead1",
        text: "📅 **Lịch ca tuần 42 (12–17/10)**\n- Ca A: 9 người + 3 bạn mới (đào tạo)\n- Ca B: 8 người\n- Ca đêm: T2, T4, T6, mỗi đêm 4 bạn + 1 QC\n- Khách Nhật: 6 bạn cut-out, @{khoa} điều phối\n\n@{boss} @{linh} anh chị xem giúp em, tối mai em gửi lịch cho các bạn.",
        files: [{ name: "lich-ca-tuan-42.xlsx", hint: "weekly shift roster week 42 with day, afternoon and night shifts plus trainees" }],
        react: { "👍": ["lead2", "khoa"] }
      },
      { by: "khoa", text: "Lịch QC ca đêm ổn, em đã báo bạn trực QC.", gap: 5 },
      { by: "lead2", text: "Ca B ok ạ. @{boss} anh nhớ duyệt vụ thử việc giúp em nhé, em cảm ơn anh 🙏", gap: 4 },
      { by: "linh", text: "Chị xem rồi, ổn. Chờ anh duyệt nữa thôi.", gap: 6, react: { "🙏": ["lead1"] } }
    ]
  }
];
