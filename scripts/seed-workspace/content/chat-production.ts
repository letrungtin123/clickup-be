import type { ChatLine, ChatScene } from "../types.js";

/**
 * #san-xuat — production floor chat (INVENTED content, local test seed only).
 * Shift handovers, job assignment, client deadlines (giờ Úc/Mỹ/Nhật), QC reminders, rush weeks.
 * Team A (lead1, ca sáng): nv01–nv08 (+ loc until 09-11). Team B (lead2, ca chiều/đêm): nv09–nv15.
 */
const sc = (date: string, time: string, lines: ChatLine[]): ChatScene => ({
  where: { channel: "san-xuat" },
  date,
  time,
  lines,
});

export const scenesProduction: ChatScene[] = [
  // ── Tue 25/8 — first day on Nesso Work ──────────────────────────────────────────────────────────
  sc("2026-08-25", "07:45", [
    {
      by: "lead1",
      text: "Chào cả nhà sản xuất 👋 Từ hôm nay tình hình ca, phân job, deadline mình báo ở kênh này thay cho nhóm Zalo nha. Việc của ai thì tag đúng người đó cho chắc.",
      react: { "👍": ["nv01", "nv02", "nv05", "nv07", "lead2"], "🎉": ["nv03"] },
    },
    {
      by: "lead1",
      text: "## Đầu ca sáng 25/8 – nhóm A\n- Tồn hôm qua: 3 đơn, 186 ảnh\n- HDR agency BĐS Sydney: 85 ảnh, deadline 9h sáng mai giờ Sydney (= 6h sáng VN)\n- Sky replacement: 40 ảnh, giao trước 15h hôm nay\n- Object removal: 22 ảnh, không gấp",
      gap: 2,
    },
    {
      by: "lead1",
      text: "@{nv05} nhận đơn HDR 85 ảnh nhé, @{nv06} làm cùng từ ảnh 43 trở đi. @{nv02} lo sky 40 ảnh. @{nv04} object removal.",
      react: { "✅": ["nv05", "nv06", "nv02", "nv04"] },
    },
    { by: "nv05", text: "Dạ em nhận. File gốc trong folder 25-08 trên NAS phải không ạ?" },
    { by: "lead1", text: "Đúng rồi, `SanXuat/2026-08/25-08`. Xong ảnh nào bỏ vào `_done` ảnh đó nha." },
    {
      by: "boss",
      text: "Anh cũng vào kênh này theo dõi. Các em cứ báo tình hình bình thường, vướng gì thì tag anh hoặc chị Linh nhé.",
      gap: 9,
      react: { "❤️": ["lead1", "nv01", "nv03", "linh"], "👍": ["nv05", "nv07", "khoa"] },
      thread: [
        { by: "lead1", text: "Dạ sếp. Cuối ca em tổng kết số ảnh ở đây luôn ạ.", gap: 3 },
        { by: "nv08", text: "Tag tên là gõ @ rồi chọn người đúng không ạ? 😅" },
        { by: "linh", text: "Đúng rồi em, gõ @ là hiện danh sách, chọn là xong." },
      ],
    },
  ]),
  sc("2026-08-25", "13:40", [
    {
      by: "acc1",
      text: "Bên account báo đơn mới: agency BĐS Sydney gửi thêm **120 ảnh HDR** (5 bracket/ảnh), deadline 9h sáng thứ 5 giờ Sydney = 7h sáng thứ 5 bên mình. Khách cũ, style giống đơn tháng 7.",
      edited: "Bên account báo đơn mới: agency BĐS Sydney gửi thêm **120 ảnh HDR** (5 bracket/ảnh), deadline 9h sáng thứ 5 giờ Sydney = **6h sáng thứ 5** bên mình. Khách cũ, style giống đơn tháng 7.",
      react: { "👀": ["lead2", "khoa"] },
    },
    { by: "lead2", text: "Nhóm B nhận nha. @{nv09} @{nv10} mỗi bạn 60 ảnh, chiều nay làm được bao nhiêu báo số giúp mình." },
    { by: "nv09", text: "Dạ ok ạ" },
    { by: "nv10", text: "Em đang dở 10 ảnh đơn cũ, xong là vô liền ạ" },
    {
      by: "acc1",
      text: "Khách dặn thêm: cửa sổ kéo vừa phải, thấy được cây bên ngoài là được, đừng xanh lè quá.",
      react: { "👍": ["nv09", "nv10", "lead2"] },
    },
    {
      by: "khoa",
      text: "Đơn này lần trước bị trả 4 ảnh vì trần nhà ám vàng, các em cân trắng trần kỹ giúp anh nhé.",
      react: { "🙏": ["nv09", "nv10"] },
    },
  ]),
  sc("2026-08-25", "16:05", [
    {
      by: "lead1",
      text: "## Cuối ca sáng 25/8\n- HDR Sydney 85 ảnh: xong 52, còn 33 (@{nv05} @{nv06} ở lại tới 18h)\n- Sky 40 ảnh: giao khách lúc 14h50 ✅\n- Object removal: 15/22\n\nBàn giao @{lead2} nhé.",
      react: { "👍": ["lead2", "nv05"] },
    },
    { by: "lead2", text: "Nhận ca 👍 Phần còn lại mình theo dõi." },
    {
      by: "boss",
      text: "Ngày đầu chạy app mà báo cáo gọn ghê 👏",
      gap: 12,
      react: { "😂": ["nv02", "nv07"], "❤️": ["lead1"] },
    },
    { by: "lead1", text: "Dạ để sếp đỡ phải lướt Zalo tìm tin 😄" },
  ]),

  // ── Wed 26/8 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-08-26", "07:50", [
    {
      by: "lead1",
      text: "Đầu ca 26/8 nhóm A:\n- HDR Sydney 85 ảnh đã giao lúc 5h40 ✅\n- Đơn mới: HDR 64 ảnh (khách Úc), twilight 18 ảnh, object removal 30 ảnh\n- Gấp nhất: twilight 18 ảnh trước 13h",
      react: { "🔥": ["boss"], "👍": ["nv01", "nv07"] },
    },
    { by: "lead1", text: "@{nv07} nhận twilight 18 ảnh. @{nv01} @{nv08} chia đôi HDR 64 ảnh. @{loc} làm object removal 30 ảnh nhé." },
    { by: "loc", text: "Dạ em nhận ạ." },
    { by: "nv08", text: "@{nv01} lấy từ 1–32 nha, mình làm 33–64" },
    { by: "nv01", text: "Ok bạn 👌" },
  ]),
  sc("2026-08-26", "10:20", [
    { by: "nv07", text: "Twilight đơn này khách muốn trời tím hồng hay cam đậm vậy ạ? Trong note không ghi @{acc1}" },
    { by: "acc1", text: "Để mình check lại mail khách nha" },
    {
      by: "acc1",
      text: "Khách gửi ảnh mẫu nè: trời chuyển cam sang tím nhẹ, đèn trong nhà bật ấm.",
      gap: 12,
      files: [{ name: "mau-twilight-khach-uc.jpg", hint: "before/after day-to-dusk mẫu khách gửi: nhà mái ngói, trời cam chuyển tím nhẹ, đèn trong nhà vàng ấm" }],
    },
    { by: "nv07", text: "Dạ rõ rồi ạ, em làm theo mẫu này." },
    {
      by: "khoa",
      text: "Lưu ý cỏ trước nhà cũng phải tối theo, đừng để cỏ xanh sáng như ban ngày nhé @{nv07}",
      react: { "🙏": ["nv07"], "💯": ["lead1"] },
    },
  ]),
  sc("2026-08-26", "20:30", [
    { by: "lead2", text: "Ca chiều cập nhật: HDR 120 ảnh Sydney xong 74/120. Dự kiến 22h xong hết." },
    {
      by: "nv12",
      text: "Photoshop máy em vừa crash lúc đang save PSD 😢 mất khoảng 20 phút làm",
      react: { "😢": ["nv13", "nv11"] },
      thread: [
        { by: "nv13", text: "Tuần trước máy mình cũng vậy, bật autosave 5 phút là đỡ hẳn", gap: 4 },
        { by: "nv12", text: "Dạ cảm ơn bạn, em bật liền" },
      ],
    },
    { by: "lead2", text: "Có bật autosave không em? Vào Preferences > File Handling chỉnh 5 phút lưu 1 lần nha." },
    { by: "nv12", text: "Giờ em bật rồi ạ. Mở lại thì recover được một nửa." },
    { by: "lead2", text: "Ok, sáng mai mình nhờ anh Minh kiểm tra RAM máy em." },
    {
      by: "nv09",
      text: "Phần của em xong rồi, em phụ @{nv10} 15 ảnh cuối nha",
      gap: 18,
      react: { "👏": ["lead2"], "❤️": ["nv10"] },
    },
  ]),

  // ── Thu 27/8 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-08-27", "08:10", [
    {
      by: "nv08",
      text: "Đơn HDR 64 ảnh có 2 ảnh (IMG_0412, IMG_0418) chỉ có 3 bracket, thiếu tấm tối nên cửa sổ cháy trắng. Xin file gốc bổ sung được không ạ? @{acc2}",
    },
    { by: "acc2", text: "Để mình mail khách xin lại nha, bên Úc giờ này 11h trưa chắc trả lời sớm." },
    {
      by: "acc2",
      text: "Khách gửi rồi nè, mình để trong folder `_bosung` của đơn. Khách xin lỗi vì upload thiếu 🙏",
      gap: 45,
      react: { "👍": ["nv08", "lead1"] },
    },
    { by: "nv08", text: "Dạ em nhận được rồi ạ, cảm ơn nhiều." },
    {
      by: "lead1",
      text: "Lần sau gặp ảnh thiếu bracket cứ báo sớm như vầy nhé, đừng tự 'cứu' rồi bị trả về.",
      react: { "💯": ["khoa", "acc2"], "👍": ["nv08"] },
    },
  ]),
  sc("2026-08-27", "14:00", [
    {
      by: "khoa",
      text: "QC tuần này có mấy lỗi lặp lại, mọi người lưu ý:\n- Cột nhà, đường chân trời nghiêng, chưa chỉnh lens\n- Halo trắng quanh tán cây khi thay trời\n- Tường trắng ám xanh do cửa sổ\n- Sót dây điện ngoài trời ở đơn có yêu cầu xoá\n\nAi chưa rõ cách xử lý halo thì 15h anh demo nhanh 15 phút.",
      react: { "👍": ["nv02", "nv05", "nv06", "nv09"], "👀": ["nv08", "lead1"] },
      thread: [
        { by: "nv02", text: "Demo ở phòng họp nhỏ hả anh? Em muốn xem phần halo", gap: 4 },
        { by: "khoa", text: "Ừ 15h phòng họp nhỏ, ai rảnh qua." },
        { by: "nv13", text: "Ca chiều tụi em vào xem được không anh?" },
        { by: "khoa", text: "Được chứ, 15h ca chiều vào rồi mà 😄" },
      ],
    },
    { by: "nv06", text: "Dạ lỗi tường ám xanh là ảnh của em đơn hôm qua, em sửa lại rồi ạ" },
  ]),
  sc("2026-08-27", "16:00", [
    {
      by: "lead1",
      text: "Bàn giao ca 27/8:\n- HDR 64 ảnh: giao 15h20 ✅\n- Object removal 30 ảnh (@{loc}): còn 6 ảnh, ca chiều @{nv14} làm tiếp\n- Đơn mới lúc 15h: 45 ảnh HDR khách Mỹ, deadline 8h sáng mai giờ New York = 19h tối mai bên mình\n\n@{lead2} nhận giúp nhé.",
    },
    { by: "lead2", text: "Nhận nha. @{nv14} xem tin trên giúp mình." },
    { by: "nv14", text: "Dạ em thấy rồi ạ" },
    { by: "loc", text: "File đang dở mình để trong `_wip`, tên file có chữ LOC nha @{nv14}" },
  ]),

  // ── Fri 28/8 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-08-28", "07:40", [
    {
      by: "lead1",
      text: "Đầu ca 28/8. Phân job hôm nay mình để trong file đính kèm, mọi người mở xem phần của mình nhé.",
      files: [{ name: "phan-job-28-08.xlsx", hint: "bảng phân job ca sáng 28/8: mã đơn nội bộ, loại việc, số ảnh, người làm, deadline giờ Úc/Mỹ và giờ VN" }],
      react: { "👍": ["nv01", "nv03", "nv04", "nv05"], "✅": ["nv07"] },
    },
    { by: "nv03", text: "Em có tên 2 dòng virtual staging nhưng chưa thấy file gốc ạ" },
    { by: "lead1", text: "Đơn đó bên account đang chờ khách xác nhận style, @{acc2} nắm nha." },
    { by: "acc2", text: "Trưa nay có nha, khách bên Mỹ đang ngủ 😅" },
    { by: "nv04", text: "Em nhận 35 ảnh object removal, 14h xong ạ" },
  ]),
  sc("2026-08-28", "11:30", [
    {
      by: "acc2",
      text: "Có đơn virtual staging **khách Mỹ** nè: **30 ảnh** phòng khách + phòng ngủ trống, style **modern farmhouse**. Deadline 9h sáng thứ 2 giờ New York. @{nv03} @{nv13} hai bạn nhận nhé.",
      react: { "👍": ["nv03", "lead1"] },
      thread: [
        { by: "nv13", text: "Khách có gửi mood board không ạ?", gap: 5 },
        {
          by: "acc2",
          text: "Có, đây nha",
          files: [{ name: "moodboard-modern-farmhouse.pdf", hint: "mood board modern farmhouse: sofa kem, sàn gỗ sáng, thảm dệt thô, đèn treo kim loại đen" }],
        },
        { by: "nv03", text: "Sofa kem, sàn gỗ sáng, thảm dệt thô, đèn treo kim loại đen — em hiểu vậy đúng không ạ?" },
        { by: "acc2", text: "Chuẩn rồi. Nhớ giữ bóng đổ đồ nội thất cho thật nha, khách soi kỹ phần này." },
      ],
    },
    { by: "nv03", text: "Em làm phòng khách, @{nv13} làm phòng ngủ nhé?" },
    { by: "nv13", text: "Ok luôn, chiều vào mình làm" },
  ]),
  sc("2026-08-28", "21:00", [
    {
      by: "lead2",
      text: "Tổng kết ca chiều 28/8:\n- HDR 45 ảnh khách Mỹ: giao 18h40 ✅ (sớm 20 phút)\n- Object removal: xong\n- Virtual staging: @{nv13} xong 4/15 phòng ngủ\n\nCa chiều về nhé mọi người, cảm ơn cả nhà.",
      react: { "👏": ["linh"], "🔥": ["nv10"] },
    },
    {
      by: "boss",
      text: "Giao sớm 20 phút là khách Mỹ thích lắm đó. Cảm ơn nhóm B 💪",
      gap: 15,
      react: { "❤️": ["lead2", "nv09", "nv10", "nv13"] },
    },
    { by: "nv10", text: "Dạ cảm ơn sếp ạ 😁" },
  ]),

  // ── Sat 29/8 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-08-29", "08:00", [
    {
      by: "lead1",
      text: "Thứ 7 ca sáng có 6 bạn. Hôm nay chủ yếu xử lý tồn:\n- Virtual staging 30 ảnh (@{nv03})\n- HDR 52 ảnh agency Brisbane (@{nv05} @{nv01})\n- Ảnh trả về sửa: 7 ảnh (@{nv06})",
      react: { "👍": ["nv01", "nv06"] },
    },
    {
      by: "linh",
      text: "Các trưởng ca nhắc các bạn đăng ký **ca trực lễ 1–2/9** giúp chị nhé, chiều nay chị chốt. Ai trực được thì reply vào thread này.",
      gap: 10,
      react: { "👀": ["lead1", "lead2"] },
      thread: [
        { by: "nv01", text: "Em trực được ngày 1/9 ạ", gap: 3 },
        { by: "nv06", text: "Em trực cả 2 ngày luôn chị, lễ này em không về quê" },
        { by: "nv10", text: "Em trực 2/9 ạ" },
        { by: "nv15", text: "Em đăng ký 1/9 ạ" },
        { by: "nv05", text: "Em trực 2/9 được ạ" },
        { by: "linh", text: "Cảm ơn các em, chị cần thêm 1 bạn ngày 1 và 1 bạn ngày 2 nữa nha." },
      ],
    },
  ]),
  sc("2026-08-29", "15:30", [
    { by: "boss", text: "Tuần đầu chạy kênh này anh thấy dễ theo dõi hơn Zalo hẳn. Tuần này tình hình sao rồi các em? Có đơn nào trễ không?" },
    { by: "lead1", text: "Dạ không có đơn trễ sếp. Tuần này nhóm A ra được 1.240 ảnh, trả về sửa 18 ảnh." },
    { by: "lead2", text: "Nhóm B 980 ảnh ạ, trả về 11 ảnh." },
    {
      by: "boss",
      text: "Tốt. Trả về dưới 2% là đẹp rồi. Cuối tuần nghỉ ngơi nha các em 👍",
      react: { "👍": ["lead1", "lead2", "khoa", "nv02", "nv07"], "❤️": ["nv04"] },
      thread: [
        { by: "nv01", text: "Dạ cảm ơn @{boss} ạ 😄", gap: 3 },
        { by: "nv05", text: "Cuối tuần ngủ bù thôi 😴" },
      ],
    },
    { by: "khoa", text: "Dạ tuần sau QC gửi báo cáo chi tiết theo từng loại lỗi ạ." },
  ]),

  // ── Mon 31/8 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-08-31", "08:00", [
    {
      by: "linh",
      text: "## Lịch ca trực lễ Quốc khánh\n- **Thứ 3 – 1/9** (8:00–17:00): @{lead1}, @{nv01}, @{nv06}, @{nv11}, @{nv15}\n- **Thứ 4 – 2/9** (8:00–17:00): @{lead2}, @{nv05}, @{nv06}, @{nv10}, @{nv12}\n\nNgày trực tính lương lễ theo quy định. Đơn khách Úc/Mỹ dồn vào 2 ngày này bên account sẽ báo trước. Cả nhà nghỉ lễ vui vẻ nha! 🇻🇳",
      react: { "👍": ["lead1", "lead2", "nv01", "nv06", "nv10"], "🎉": ["nv15", "nv12"] },
      thread: [
        { by: "nv11", text: "Chị ơi em có tên 1/9 nhưng buổi chiều em có việc nhà, em trực tới 13h được không ạ?", gap: 15 },
        { by: "linh", text: "Được em, chị ghi chú lại. @{lead1} lưu ý giúp chị nha." },
        { by: "lead1", text: "Dạ ok chị." },
      ],
    },
  ]),
  sc("2026-08-31", "14:15", [
    { by: "acc1", text: "Khách Úc gửi đơn trước lễ: **150 ảnh HDR + 20 ảnh twilight**, deadline sáng thứ 5 (3/9) giờ Sydney. Đề xuất hôm nay làm 70 ảnh HDR, phần còn lại để ca trực lễ." },
    { by: "lead1", text: "Hôm nay nhóm A làm hết 70 HDR được. @{nv02} @{nv07} làm luôn twilight 20 ảnh cho đỡ dồn nha." },
    { by: "nv07", text: "Dạ, em lấy 10 ảnh đầu." },
    { by: "nv02", text: "Mình 10 ảnh cuối" },
    { by: "lead2", text: "Ca chiều nhóm B làm thêm 30 ảnh HDR nữa, cho ca trực lễ nhẹ bớt." },
    { by: "acc1", text: "Cảm ơn hai trưởng ca 🙏", react: { "👍": ["lead1", "lead2"] } },
  ]),
  sc("2026-08-31", "19:30", [
    { by: "nv14", text: "Máy em (bàn 14) treo cứng lần thứ 2 rồi, chuột cũng không di được 😢" },
    { by: "lead2", text: "Giữ nút nguồn tắt hẳn rồi mở lại xem. File đang làm lưu chưa em?" },
    { by: "nv14", text: "Lưu rồi ạ, mất chừng 3 ảnh thôi" },
    { by: "lead2", text: "Ok, tối nay qua máy dự phòng số 20 làm tạm. Mai mình báo IT." },
    { by: "nv11", text: "Máy 20 hôm qua mình mới dùng, chạy ổn nha" },
  ]),

  // ── Tue 1/9 – Wed 2/9: nghỉ lễ Quốc khánh, ca trực ─────────────────────────────────────────────
  sc("2026-09-01", "08:05", [
    {
      by: "lead1",
      text: "Ca trực lễ 1/9 có mặt đủ 5 người ✅\n- HDR còn lại đơn Úc: 50 ảnh\n- Twilight: còn 6 ảnh\n- Đơn mới khách Mỹ vào tối qua: 28 ảnh object removal, giao trong hôm nay",
      react: { "👍": ["nv01", "nv06"] },
    },
    {
      by: "boss",
      text: "Cảm ơn các em đi trực lễ nhé. Trưa nay anh đặt cơm + trà sữa cho ca trực, đừng đặt đồ ăn riêng 😄",
      gap: 25,
      react: { "❤️": ["lead1", "nv01", "nv06", "nv11", "nv15"], "🎉": ["nv06"] },
      thread: [
        { by: "nv15", text: "Dạ em cảm ơn anh ạ 🥰", gap: 2 },
        { by: "nv06", text: "Sếp chu đáo quá 😁" },
        { by: "lead1", text: "Trưa em chụp hình ca trực gửi sếp xem ạ" },
      ],
    },
    { by: "nv11", text: "Em xong 10 ảnh object removal rồi ạ, 13h em về như đã báo nha", gap: 40 },
    { by: "lead1", text: "Ok em, nhớ để file vào `_done` giùm mình." },
  ]),
  sc("2026-09-01", "15:00", [
    {
      by: "lead1",
      text: "Cuối ca trực 1/9:\n- HDR đơn Úc: 50/50 ✅\n- Twilight: xong ✅\n- Object removal khách Mỹ: 28/28, giao 14h40 ✅\n\nMai ca trực của @{lead2} chỉ còn đơn khách Mỹ mới vào chiều nay (40 ảnh). Cả nhà nghỉ lễ vui nha!",
      react: { "👏": ["boss", "linh", "lead2", "acc1"], "🔥": ["nv06"] },
    },
    { by: "lead2", text: "Hay quá, mai nhẹ ca rồi 😂" },
  ]),
  sc("2026-09-02", "08:10", [
    { by: "lead2", text: "Ca trực 2/9 điểm danh: mình, @{nv05}, @{nv06}, @{nv10}, @{nv12}. Đơn hôm nay: 40 ảnh HDR khách Mỹ, deadline 8h sáng mai giờ New York = 19h tối nay VN." },
    { by: "nv10", text: "Có mặt ạ ✋" },
    { by: "nv12", text: "Em tới rồi, đang mở máy" },
    {
      by: "nv06",
      text: "Trực ngày thứ 2 liên tiếp, ai cho em xin ly cà phê không 😂",
      react: { "😂": ["nv05", "nv10", "lead2"] },
    },
    { by: "nv05", text: "Mua dư 1 ly nè, lên lấy đi" },
  ]),
  sc("2026-09-02", "11:45", [
    { by: "nv12", text: "Ảnh số 17 đơn khách Mỹ thiếu tấm sáng nhất, góc phòng tối quá. Lễ này account có ai trực không ạ?" },
    { by: "lead2", text: "@{acc2} hôm nay có online không? Không thì mình làm tạm 4 bracket rồi note lại cho khách." },
    {
      by: "acc2",
      text: "Mình online nè. Bên Mỹ đang nửa đêm nên không xin kịp đâu, cứ làm 4 bracket, mình ghi chú trong mail giao hàng.",
      gap: 20,
    },
    { by: "nv12", text: "Dạ ok ạ" },
  ]),
  sc("2026-09-02", "17:00", [
    {
      by: "lead2",
      text: "Tổng kết lễ 2/9: đơn 40 ảnh khách Mỹ giao lúc 16h30 ✅, sớm hơn deadline 2 tiếng rưỡi. Cảm ơn cả ca trực 🙌",
      react: { "👏": ["lead1", "acc2"] },
    },
    {
      by: "boss",
      text: "Lễ mà vẫn giao sớm, các em giỏi quá. Ca trực lễ có thêm phụ cấp như chị Linh đã báo nhé.",
      gap: 8,
      react: { "❤️": ["lead2", "nv05", "nv06", "nv10", "nv12"], "🎉": ["nv10"] },
    },
    { by: "linh", text: "Chị ghi nhận rồi ạ 👍" },
  ]),
  // ── Thu 3/9 — back after the holiday ───────────────────────────────────────────────────────────
  sc("2026-09-03", "07:45", [
    {
      by: "lead1",
      text: "Đầu ca 3/9 sau lễ, tồn khá nhiều:\n- 4 đơn HDR: 312 ảnh\n- 1 đơn twilight: 25 ảnh\n- 1 đơn virtual staging: 12 ảnh\n- 9 ảnh khách trả về sửa\n\nSáng nhóm A tập trung HDR, chiều nhóm B gánh tiếp.",
    },
    {
      by: "lead1",
      text: "Phân job: @{nv01} @{nv05} @{nv08} HDR đơn Perth 120 ảnh. @{nv06} @{loc} HDR đơn Sydney 96 ảnh. @{nv07} twilight. @{nv03} staging. @{nv02} @{nv04} sửa 9 ảnh trả về rồi vào HDR đơn còn lại.",
      gap: 3,
      react: { "✅": ["nv01", "nv05", "nv06", "nv07", "loc"] },
    },
    { by: "nv04", text: "9 ảnh trả về lỗi gì vậy ạ, có note của khách không?" },
    { by: "khoa", text: "Có, anh để comment trong file QC rồi. Chủ yếu tường ám màu, lát anh nói rõ hơn ở đây." },
  ]),
  sc("2026-09-03", "10:40", [
    {
      by: "khoa",
      text: "9 ảnh trả về trước lễ: khách phàn nàn tường trắng bị ám vàng cam từ đèn trần. Minh hoạ đây:",
      files: [{ name: "loi-tuong-am-vang.png", hint: "so sánh tường bị ám vàng cam do đèn trần và tường trắng trung tính sau khi sửa" }],
      react: { "👀": ["nv02", "nv04", "lead1"] },
    },
    {
      by: "khoa",
      text: "Cách xử lý: tách vùng tường, chỉnh white balance riêng, giữ chút ấm gần đèn cho tự nhiên. **Đừng** desaturate cả ảnh.",
      react: { "👍": ["nv02", "nv04", "lead1"] },
      thread: [
        { by: "nv02", text: "Em sửa xong 5 ảnh đầu, anh check giúp em nha", gap: 35 },
        { by: "khoa", text: "Ổn rồi, ảnh 3 tường hơi xám, kéo lại chút ấm.", gap: 15 },
        { by: "nv02", text: "Dạ em sửa liền ạ" },
        { by: "nv04", text: "4 ảnh còn lại em gửi luôn ạ" },
      ],
    },
  ]),
  sc("2026-09-03", "16:10", [
    {
      by: "lead1",
      text: "Bàn giao ca 3/9:\n- HDR Perth: 86/120\n- HDR Sydney: 61/96\n- Twilight: 25/25 ✅\n- Staging: 8/12\n- Ảnh trả về: sửa xong, @{khoa} duyệt ✅\n\n@{lead2} ca chiều ưu tiên HDR Sydney vì deadline 6h sáng mai.",
      edited: "Bàn giao ca 3/9:\n- HDR Perth: 88/120\n- HDR Sydney: 61/96\n- Twilight: 25/25 ✅\n- Staging: 8/12\n- Ảnh trả về: sửa xong, @{khoa} duyệt ✅\n\n@{lead2} ca chiều ưu tiên HDR Sydney vì deadline 6h sáng mai.",
    },
    { by: "lead2", text: "Rõ. @{nv09} @{nv10} @{nv15} vào HDR Sydney, @{nv11} @{nv14} phụ HDR Perth nhé." },
    { by: "nv15", text: "Dạ em nhận ạ" },
    { by: "nv11", text: "Ok, Perth mình lấy từ ảnh 89 nha @{nv14}" },
  ]),

  // ── Fri 4/9 ─────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-04", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 4/9: tối qua ca chiều làm xong cả 2 đơn HDR, giao đúng giờ ✅ Cảm ơn nhóm B!\nHôm nay đơn mới chưa nhiều, mình làm object removal 60 ảnh khách Mỹ + phần staging còn lại.",
      react: { "👏": ["lead2", "nv09", "nv11"] },
    },
    { by: "nv08", text: "Cho em làm object removal được không ạ, em muốn luyện thêm phần xoá xe trước nhà" },
    { by: "lead1", text: "Ok, @{nv08} lấy 30 ảnh đầu, @{nv04} 30 ảnh sau. Bí chỗ nào hỏi @{nv04} nhé." },
    { by: "nv04", text: "Có gì cứ hỏi nha 😄" },
  ]),
  sc("2026-09-04", "13:50", [
    {
      by: "nv04",
      text: "Photoshop crash 3 lần trong 1 tiếng, toàn lúc dùng Content-Aware Fill 😭 Có ai bị giống không ạ?",
      files: [{ name: "loi-photoshop-crash.png", hint: "screenshot hộp thoại lỗi Photoshop 'Program Error' khi chạy Content-Aware Fill" }],
      react: { "😢": ["nv08", "nv03"] },
    },
    { by: "nv08", text: "Em cũng bị 1 lần lúc sáng" },
    {
      by: "lead1",
      text: "Chắc do bản cập nhật tối qua. Mình báo anh Minh bên kênh IT rồi. Tạm thời dùng Patch Tool hoặc Clone Stamp nhé.",
      thread: [
        { by: "nv03", text: "Máy em chưa cập nhật, có nên tắt auto update không ạ?", gap: 5 },
        { by: "lead1", text: "Để anh Minh quyết nha, đừng tự tắt." },
      ],
    },
    {
      by: "nv04",
      text: "Anh Minh rollback bản cũ cho máy em rồi, chạy ổn lại rồi ạ 👍",
      gap: 40,
      react: { "👍": ["lead1", "nv08"] },
    },
    { by: "lead1", text: "@{nv08} máy em chắc cũng cần rollback, nhắn bên IT luôn nha." },
    { by: "nv08", text: "Dạ em nhắn rồi ạ" },
  ]),
  sc("2026-09-04", "20:45", [
    { by: "lead2", text: "Ca chiều 4/9 xong sớm, chỉ còn 12 ảnh staging cho mai. Ai xong việc cứ về nha, nhớ tắt máy." },
    { by: "nv13", text: "Em làm nốt 3 phòng ngủ rồi về ạ" },
    { by: "nv09", text: "Về thôi, bye cả nhà 👋", react: { "😂": ["nv10", "nv15"] } },
  ]),

  // ── Sat 5/9 ─────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-05", "08:15", [
    {
      by: "lead1",
      text: "Thứ 7 5/9: staging 12 ảnh (@{nv03}), HDR 70 ảnh đơn mới khách Úc (@{nv05} @{nv06} @{loc}), ảnh trả về 3 ảnh (@{nv02}).",
      react: { "👍": ["nv03", "loc"] },
    },
    {
      by: "acc2",
      text: "Báo trước: agency ở Texas gửi **90 ảnh HDR** trưa nay, deadline 9h sáng thứ 2 giờ Texas = 21h tối thứ 2 VN. Ca chiều thứ 7 làm được bao nhiêu thì làm, còn lại sáng thứ 2.",
      gap: 20,
      thread: [
        { by: "lead2", text: "Ca chiều nay nhóm B 5 người, ước làm được 50 ảnh.", gap: 6 },
        { by: "acc2", text: "Vậy là ổn rồi, cảm ơn nha 🙏" },
      ],
    },
  ]),
  sc("2026-09-05", "14:30", [
    { by: "nv09", text: "Đơn Texas ảnh nào cũng 7 bracket, merge mất 4–5 phút/ảnh 😢 Chắc em trễ phần của em @{lead2}" },
    { by: "lead2", text: "Không sao, mình chia lại. @{nv10} @{nv15} mỗi bạn lấy thêm 8 ảnh của @{nv09} nha." },
    { by: "nv10", text: "Ok" },
    { by: "nv15", text: "Dạ em lấy ảnh 31 đến 38 ạ" },
    {
      by: "khoa",
      text: "7 bracket thì không cần dùng hết đâu, chọn 3–4 tấm đủ dải sáng là được, merge nhanh mà ít bóng ma.",
      react: { "💯": ["lead2", "nv09"], "🙏": ["nv15"] },
    },
    { by: "nv09", text: "Dạ em thử liền, cảm ơn anh Khoa" },
  ]),

  // ── Mon 7/9 ─────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-07", "07:50", [
    {
      by: "lead1",
      text: "Đầu tuần 7/9:\n- Đơn Texas: còn 40 ảnh, deadline 21h tối nay VN\n- Agency Melbourne: 25 ảnh day-to-dusk\n- HDR agency Sydney: 110 ảnh, deadline 6h sáng mai\n\n@{nv07} @{nv02} day-to-dusk. @{nv01} @{nv05} @{nv06} @{nv08} HDR Sydney. @{loc} @{nv04} làm nốt đơn Texas.",
      react: { "👍": ["nv01", "nv02", "nv07", "loc"], "✅": ["nv05"] },
      thread: [
        { by: "nv01", text: "HDR Sydney 110 ảnh chia 4 thì mỗi người 27–28 ảnh hả trưởng ca?", gap: 4 },
        { by: "lead1", text: "Ừ, @{nv01} ôm thêm 2 ảnh lẻ giúp mình nha." },
        { by: "nv01", text: "Ok ạ 👌" },
      ],
    },
    { by: "loc", text: "Đơn Texas em với @{nv04} chia đôi, mỗi người 20 ảnh nha" },
    { by: "nv04", text: "Ok, mình lấy 20 ảnh cuối" },
  ]),
  sc("2026-09-07", "11:00", [
    {
      by: "acc1",
      text: "Agency Melbourne có note riêng cho day-to-dusk: **cửa sổ phải có ánh đèn vàng** nhưng không cháy, trời không được tím quá. Ảnh before/after họ thích:",
      files: [{ name: "melbourne-before-after-dusk.jpg", hint: "before/after mẫu khách gửi: day-to-dusk nhà phố, trời xanh dương đậm, chân trời cam nhẹ, đèn cửa sổ vàng ấm" }],
      react: { "👀": ["nv07", "nv02"] },
    },
    { by: "nv07", text: "Trời xanh dương đậm, chân trời cam nhẹ. Em hiểu rồi ạ 👍" },
    {
      by: "nv02",
      text: "Có cần thêm đèn sân vườn hay lửa lò sưởi không ạ? Khách lần trước thích vậy",
      thread: [
        { by: "acc1", text: "Không nha, khách này thích tự nhiên, chỉ bật đèn có sẵn thôi.", gap: 4 },
        { by: "nv02", text: "Dạ rõ ạ" },
      ],
    },
  ]),
  sc("2026-09-07", "16:00", [
    {
      by: "lead1",
      text: "Bàn giao 7/9:\n- Day-to-dusk Melbourne: 18/25\n- HDR Sydney: 64/110\n- Đơn Texas: giao 15h30 ✅\n\n@{lead2} ca chiều làm tiếp 46 ảnh HDR + 7 ảnh dusk.",
    },
    { by: "lead2", text: "Ok nhận ca. @{nv11} @{nv12} @{nv13} @{nv14} vào HDR, @{nv09} làm 7 ảnh dusk nha." },
    { by: "nv09", text: "Dạ, em xem lại ảnh mẫu khách Melbourne trước ạ" },
  ]),

  // ── Tue 8/9 ─────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-08", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 8/9: HDR Sydney + dusk Melbourne giao đúng hẹn ✅ Hôm nay có đơn **wedding retouch 45 ảnh** (khách Úc), @{nv12} chiều vào làm. Sáng nhóm A làm HDR đơn Adelaide 80 ảnh.",
      react: { "👍": ["nv01", "nv05"] },
    },
    { by: "nv12", text: "Dạ em thấy rồi ạ, chiều em vào sớm 30 phút" },
  ]),
  sc("2026-09-08", "15:00", [
    {
      by: "khoa",
      text: "Nhắc nhẹ đơn dusk Melbourne hôm qua: đèn cửa sổ ở 5 ảnh vàng quá, cam bệt. Khách chưa phàn nàn nhưng QC đã đánh dấu. Mức hợp lý là vàng ấm, vẫn thấy chi tiết rèm bên trong.",
      files: [{ name: "qc-dusk-den-cua-so.png", hint: "so sánh đèn cửa sổ vàng cam bệt và vàng ấm vẫn thấy rèm bên trong" }],
      react: { "👀": ["nv07", "nv02", "nv09"] },
    },
    { by: "nv07", text: "Dạ là ảnh của em, em rút kinh nghiệm ạ 🙏" },
    { by: "nv02", text: "Có 1 ảnh của em trong đó luôn ạ" },
    {
      by: "khoa",
      text: "Không sao, cái này khó. Anh gửi preset màu đèn cho cả nhóm dùng chung nhé.",
      react: { "🙏": ["nv07", "nv02"], "❤️": ["nv07"] },
      thread: [
        { by: "lead1", text: "Anh để preset vào folder chung nhé, em nhắc nhóm A dùng.", gap: 5 },
        { by: "khoa", text: "Ok, `QC/Preset/Dusk` nha." },
        { by: "lead2", text: "Nhóm B cũng dùng luôn ạ 👍" },
      ],
    },
  ]),
  sc("2026-09-08", "19:45", [
    { by: "lead2", text: "Ca chiều 8/9: wedding retouch @{nv12} xong 20/45. Khách muốn da mịn nhưng giữ texture, mắt sáng nhẹ, **không** làm thon mặt." },
    { by: "nv12", text: "Ảnh cô dâu tóc bay nhiều quá, em tách tóc hơi lâu ạ" },
    { by: "lead2", text: "Không gấp, deadline tối mai. Làm kỹ là được." },
    { by: "nv11", text: "Cần phụ thì gọi mình nha, mình rảnh rồi" },
  ]),

  // ── Wed 9/9 — sinh nhật nv04 ────────────────────────────────────────────────────────────────────
  sc("2026-09-09", "07:45", [
    {
      by: "lead1",
      text: "Đầu ca 9/9 – trước hết chúc mừng sinh nhật @{nv04} 🎂🎉 15h nhóm A có bánh nhỏ nha!",
      react: { "🎉": ["nv01", "nv02", "nv03", "nv05", "nv06", "boss"], "❤️": ["nv04", "linh"] },
      thread: [
        { by: "nv08", text: "Bánh vị gì vậy ạ 😆", gap: 3 },
        { by: "lead1", text: "Bí mật 🤫" },
        { by: "loc", text: "Chắc lại tiramisu như năm ngoái 😂", react: { "😂": ["nv08", "nv04"] } },
      ],
    },
    { by: "nv04", text: "Em cảm ơn mọi người nhiều ạ 🥹" },
    {
      by: "boss",
      text: "Chúc mừng sinh nhật em, tuổi mới ảnh càng ngày càng đẹp nhé 🎉",
      gap: 15,
    },
    {
      by: "lead1",
      text: "Việc hôm nay:\n- HDR Adelaide: còn 30 ảnh\n- Staging khách Mỹ: 20 ảnh (@{nv03})\n- Đơn mới: sky replacement 55 ảnh, @{nv02} @{nv07}",
      react: { "👍": ["nv02", "nv03", "nv07"] },
    },
  ]),
  sc("2026-09-09", "13:30", [
    { by: "lead2", text: "Nhận ca chiều 9/9. @{acc2} đơn gấp khách Mỹ lúc trưa là đơn nào nhỉ?" },
    { by: "acc2", text: "Đơn staging 16 ảnh, khách cần trước 7h sáng giờ LA = 21h tối nay VN. Style **Scandinavian**: tường trắng, gỗ sáng, ít đồ." },
    { by: "lead2", text: "@{nv13} nhận nhé. @{nv03} sáng làm staging rồi, chuyển style cho @{nv13} luôn." },
    { by: "nv03", text: "Mình để file đồ nội thất 3D trong folder chung rồi nha @{nv13}" },
    { by: "nv13", text: "Dạ 21h xong ạ" },
    {
      by: "nv13",
      text: "Staging 16 ảnh xong lúc 20h35 ✅",
      gap: 420,
      react: { "👏": ["acc2", "lead2"], "🔥": ["boss"] },
    },
  ]),

  // ── Thu 10/9 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-10", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 10/9:\n- Sky 55 ảnh: còn 12\n- HDR mới khách Úc: 140 ảnh, deadline 6h sáng thứ 7\n- Wedding retouch: giao rồi ✅\n\n@{nv01} @{nv05} @{nv06} @{nv08} @{loc} chia HDR 140 ảnh, mỗi người 28 ảnh.",
      react: { "✅": ["nv01", "nv05", "nv06", "nv08", "loc"] },
    },
    { by: "nv02", text: "Sky 12 ảnh còn lại em với @{nv07} xong trước 10h ạ" },
  ]),
  sc("2026-09-10", "10:30", [
    {
      by: "linh",
      text: "Thông báo sớm để các em sắp xếp: **từ thứ 2 14/9 đến thứ 7 19/9** là mùa cao điểm của các agency BĐS bên Úc (bên đó vào xuân), account dự kiến 2.000–2.500 ảnh/tuần. Công ty mở **ca đêm 20:00–02:00**, có phụ cấp ca đêm và tiền ăn khuya.\n\nAi đăng ký được ca đêm thì reply trong thread này, ghi rõ ngày nhé.",
      react: { "👀": ["nv01", "nv09", "nv10", "lead1", "lead2"], "😮": ["nv08", "nv15"] },
      thread: [
        { by: "nv09", text: "Em đăng ký ca đêm 14, 15, 19 ạ", gap: 6 },
        { by: "nv10", text: "Em làm được cả tuần luôn chị" },
        { by: "nv06", text: "Em đăng ký 17, 18 ạ" },
        { by: "nv13", text: "Em 14 và 16 ạ" },
        { by: "lead2", text: "Chị Linh ơi em đi ca đêm cả tuần, ca ngày nhờ @{lead1} lo giúp nhé." },
        { by: "linh", text: "Ok, chị tổng hợp rồi thứ 7 chốt lịch nha." },
      ],
    },
  ]),
  sc("2026-09-10", "16:00", [
    {
      by: "lead1",
      text: "Bàn giao 10/9:\n- Sky 55 ảnh: xong ✅\n- HDR 140: 75/140\n- Staging khách Mỹ: xong ✅\n\nCa chiều làm tiếp HDR, mục tiêu tới 22h còn dưới 20 ảnh.",
    },
    { by: "lead2", text: "Nhận. Nhóm B tối nay full 7 người, chắc xong luôn 😎", react: { "🔥": ["nv10", "nv11"] } },
  ]),

  // ── Fri 11/9 — Lộc's last day ───────────────────────────────────────────────────────────────────
  sc("2026-09-11", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 11/9: HDR 140 ảnh ca chiều đã xong hết, giao sớm 1 ngày ✅🔥\n\nHôm nay cũng là ngày làm cuối của @{loc} ở nhóm A 😢 Lộc bàn giao giúp mình đơn đang làm cho @{nv01} nhé.",
      react: { "😢": ["nv01", "nv02", "nv04", "nv05", "nv08"], "🔥": ["lead2"] },
    },
    { by: "loc", text: "Dạ em có 2 việc đang dở: object removal 15 ảnh và 4 ảnh trả về. Em note trong file và để folder `_wip/LOC-bangiao` rồi ạ @{nv01}" },
    { by: "nv01", text: "Ok mình nhận, có gì hỏi lại nha" },
  ]),
  sc("2026-09-11", "15:30", [
    {
      by: "loc",
      text: "Mai em nghỉ rồi nên em chào mọi người luôn ạ. Cảm ơn trưởng ca và cả nhóm đã chỉ em từ hồi mới vào chưa biết blend HDR là gì 😅 Chúc nhóm mình đơn nhiều, ít bị trả về!",
      react: { "❤️": ["lead1", "nv01", "nv02", "nv03", "nv04", "nv05"], "😢": ["nv08", "nv06"] },
      thread: [
        { by: "lead1", text: "Cảm ơn em thời gian qua nha. Ở thành phố mới có gì cứ nhắn nhóm 💪", gap: 3 },
        { by: "boss", text: "Cảm ơn em đã đồng hành. Lúc nào về Sài Gòn ghé công ty chơi nhé.", gap: 10 },
        { by: "nv05", text: "Nhớ ông lắm đó 😭" },
        { by: "khoa", text: "Đi mạnh giỏi nha em, file HDR của em thuộc loại ít lỗi nhất nhóm đó 👍" },
        { by: "loc", text: "Dạ em cảm ơn anh, cảm ơn mọi người ạ 🙏", react: { "❤️": ["khoa", "nv05"] } },
      ],
    },
  ]),
  sc("2026-09-11", "20:00", [
    { by: "lead2", text: "Ca chiều 11/9: hôm nay nhẹ, object removal + staging xong hết. Nhắc nhóm B tuần sau có ca đêm, bạn nào đăng ký rồi thì sắp xếp ngủ nghỉ trước nha." },
    { by: "nv10", text: "Dạ tuần sau cày 🔥", react: { "😂": ["nv09", "nv11"] } },
  ]),

  // ── Sat 12/9 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-12", "08:10", [
    { by: "lead1", text: "Thứ 7 12/9: ca sáng làm đơn HDR 60 ảnh và ảnh trả về. Mọi người tranh thủ dọn folder `_wip` trên NAS, tuần sau đơn về nhiều lắm." },
    {
      by: "acc1",
      text: "Account update: tuần sau đã có **14 đơn** xác nhận từ các agency Sydney/Melbourne/Brisbane, tổng khoảng **2.300 ảnh**, chủ yếu HDR + sky + twilight. Thứ 2 7h30 mình gửi danh sách chi tiết.",
      gap: 15,
      react: { "😮": ["nv05", "nv06", "nv08"], "🔥": ["lead1", "lead2"], "👀": ["khoa"] },
    },
    {
      by: "boss",
      text: "Tuần sau căng đây. Trưởng ca nào thiếu người thì báo anh với chị Linh ngay nhé, đừng để dồn rồi mới báo.",
      react: { "👍": ["lead1", "lead2", "linh"] },
      thread: [
        { by: "lead2", text: "Dạ @{boss}, nhóm B đã có danh sách ca đêm, chiều nay chị Linh chốt ạ.", gap: 6 },
        { by: "nv05", text: "Tuần sau chắc phải mua cà phê dự trữ 😂", react: { "😂": ["nv06", "lead2"] } },
      ],
    },
    { by: "lead1", text: "Dạ sếp 👍" },
  ]),
  sc("2026-09-12", "14:00", [
    {
      by: "linh",
      text: "## Lịch ca đêm mùa cao điểm 14–19/9 (20:00–02:00)\n- **T2 14/9**: @{lead2}, @{nv09}, @{nv10}, @{nv13}\n- **T3 15/9**: @{lead2}, @{nv09}, @{nv10}, @{nv14}\n- **T4 16/9**: @{lead2}, @{nv10}, @{nv11}, @{nv13}\n- **T5 17/9**: @{lead2}, @{nv06}, @{nv10}, @{nv12}\n- **T6 18/9**: @{lead2}, @{nv06}, @{nv10}, @{nv15}\n- **T7 19/9**: @{lead2}, @{nv09}, @{nv11}\n\nCa đêm có phụ cấp và tiền ăn khuya. Ai đổi ca thì tự tìm người đổi và báo trưởng ca. Hôm sau ca đêm được vào trễ đến 10h.",
      react: { "👍": ["lead2", "nv09", "nv10", "nv13", "nv14"], "✅": ["nv11", "nv06", "nv12"] },
      thread: [
        { by: "nv15", text: "Em có tên ngày 18 ạ, mà em chưa quen đơn Úc lắm, có ai kèm không ạ?", gap: 8 },
        { by: "lead2", text: "Có mình với @{nv10} kèm, yên tâm nha." },
        { by: "nv10", text: "Ngồi cạnh mình là được 😄" },
        { by: "linh", text: "Em cứ làm bình thường, gặp ảnh khó thì hỏi liền nha 👍" },
      ],
    },
  ]),
  // ── Mon 14/9 – Sat 19/9: tuần cao điểm agency Úc, ca đêm ───────────────────────────────────────
  sc("2026-09-14", "07:30", [
    {
      by: "lead1",
      text: "## Đầu ca 14/9 – TUẦN CAO ĐIỂM 🔥\n- 6 đơn HDR: 1.020 ảnh\n- 3 đơn sky replacement: 210 ảnh\n- 2 đơn twilight: 60 ảnh\n- 1 đơn virtual staging: 24 ảnh\n\nFile phân job chi tiết đính kèm. Mỗi bạn mục tiêu 90–110 ảnh/ngày. Ảnh khó (ngược sáng, nhiều cửa sổ) báo mình để chia lại.",
      files: [{ name: "phan-job-tuan-cao-diem-14-09.xlsx", hint: "phân job tuần cao điểm 14–19/9: đơn, agency (Sydney/Melbourne/Brisbane), loại việc, số ảnh, người làm, ca, deadline giờ Úc và giờ VN" }],
      react: { "🔥": ["nv01", "nv02", "nv05", "nv06", "nv07"], "💯": ["boss"], "👍": ["linh", "khoa"] },
      thread: [
        { by: "nv08", text: "Em có 100 ảnh HDR đơn Brisbane, deadline 6h sáng thứ 4 đúng không ạ?", gap: 6 },
        { by: "lead1", text: "Đúng, nhưng mình muốn xong trước 22h thứ 3 để QC kịp xem." },
        { by: "khoa", text: "Tuần này QC chia 2 ca, ca đêm có @{lead2} check nhanh trước khi giao." },
      ],
    },
    { by: "nv03", text: "Staging 24 ảnh em làm nha, chiều @{nv13} vào làm tiếp" },
    { by: "nv13", text: "Ok, nhớ để lại note style cho mình nha" },
  ]),
  sc("2026-09-14", "11:45", [
    {
      by: "acc1",
      text: "Thêm đơn gấp 🚨 agency BĐS Sydney vừa gửi **240 ảnh HDR** (căn hộ cao tầng, nhiều cửa kính), cần trước 9h sáng thứ 4 giờ Sydney = 6h sáng thứ 4 VN. Mình đã xác nhận với khách rồi.",
      react: { "😮": ["nv05", "nv08"], "👀": ["lead1", "lead2", "khoa"] },
    },
    { by: "lead1", text: "Ok. Ca sáng nay kín rồi, mình đẩy đơn này cho ca chiều + ca đêm nhé @{lead2}." },
    { by: "lead2", text: "Nhận. Ca chiều 7 người làm 120, ca đêm 4 người làm 120. Căn hộ nhiều kính thì window pull cẩn thận nha mọi người." },
    {
      by: "khoa",
      text: "Căn hộ cao tầng hay bị phản chiếu đèn trần lên kính, thấy rõ thì xoá. Đừng kéo cửa sổ gắt để thấy nguyên toà nhà đối diện, nhìn giả lắm.",
      react: { "👍": ["lead2", "nv09", "nv10"], "🙏": ["nv14"] },
    },
    {
      by: "boss",
      text: "Đơn lớn mà gấp, cần anh hỗ trợ gì thì tag anh nha @{lead2}.",
    },
  ]),
  sc("2026-09-14", "16:00", [
    {
      by: "lead1",
      text: "Bàn giao 14/9:\n- Nhóm A ra **512 ảnh** hôm nay 🔥\n- HDR: 430/1.020\n- Sky: 60/210\n- Twilight: 22/60\n- Staging: 10/24\n- Đơn 240 HDR Sydney: chưa bắt đầu, giao ca chiều\n\nCa chiều + ca đêm cố lên nhé!",
      edited: "Bàn giao 14/9:\n- Nhóm A ra **522 ảnh** hôm nay 🔥\n- HDR: 430/1.020\n- Sky: 60/210\n- Twilight: 22/60\n- Staging: 10/24\n- Đơn 240 HDR Sydney: chưa bắt đầu, giao ca chiều\n\nCa chiều + ca đêm cố lên nhé!",
      react: { "💯": ["boss", "khoa"], "🔥": ["lead2", "nv09"] },
      thread: [
        { by: "nv09", text: "Hơn 500 ảnh một ca luôn hả, khủng ghê 😮", gap: 3 },
        { by: "nv05", text: "Tay mình muốn rụng rồi nè 😂", react: { "😂": ["nv09", "nv06"] } },
      ],
    },
    { by: "lead2", text: "Nhận ca, nhóm B chiến 💪" },
  ]),
  sc("2026-09-14", "22:00", [
    { by: "lead2", text: "Update ca đêm 22h: đơn 240 HDR xong **118/240**. Ca chiều về rồi, ca đêm còn @{nv09} @{nv10} @{nv13} với mình." },
    { by: "nv13", text: "Em làm staging xong rồi, giờ qua HDR ạ" },
    {
      by: "boss",
      text: "Anh vẫn đang theo dõi nè. Đồ ăn khuya anh đặt rồi, 23h tới nha các em. Cố lên 💪",
      gap: 10,
      react: { "❤️": ["lead2", "nv09", "nv10", "nv13"], "🎉": ["nv10"] },
      thread: [
        { by: "nv10", text: "Sếp đặt gì vậy ạ 😆", gap: 2 },
        { by: "boss", text: "Cháo sườn với bánh mì, đủ ấm bụng thôi 😄", react: { "😂": ["nv09", "nv10"] } },
        { by: "nv09", text: "Tuyệt vời ạ, có động lực rồi 😁" },
      ],
    },
  ]),
  sc("2026-09-15", "07:40", [
    { by: "lead1", text: "Đầu ca 15/9: ca đêm qua làm tới 2h, đơn 240 HDR còn **42 ảnh**. Sáng nay @{nv01} @{nv05} @{nv08} làm xong 42 ảnh trước 11h để QC kịp xem." },
    { by: "nv05", text: "Dạ em lấy 14 ảnh đầu ạ" },
    { by: "nv01", text: "Mình lấy 14 ảnh giữa" },
    { by: "nv08", text: "14 ảnh cuối của em ✅" },
    {
      by: "khoa",
      text: "Xong ảnh nào upload folder QC ngay ảnh đó, anh check cuốn chiếu nhé.",
      react: { "👍": ["nv01", "nv05", "nv08"] },
    },
  ]),
  sc("2026-09-15", "13:20", [
    {
      by: "acc2",
      text: "Khách Brisbane phản hồi đơn giao sáng nay: **trời xanh quá, nhìn giả**, 18 ảnh cần chỉnh lại. Ảnh khách khoanh lỗi đây:",
      files: [{ name: "feedback-khach-brisbane-troi.png", hint: "screenshot email khách: khoanh đỏ bầu trời xanh quá đậm trên ảnh nhà phố" }],
      react: { "😢": ["nv02"], "👀": ["lead1", "lead2"] },
      thread: [
        { by: "acc2", text: "Khách nói thêm: thích trời có mây nhẹ hơn trời trong vắt.", gap: 3 },
        { by: "khoa", text: "Vậy dùng bộ trời 'Light Cloud', anh để sẵn trong preset rồi." },
        { by: "nv07", text: "Dạ ok anh" },
      ],
    },
    {
      by: "khoa",
      text: "Đơn này dùng trời 'Clear Blue 03', bão hoà quá. Chuyển sang 'Soft Blue 01' và giảm saturation trời khoảng 15–20 nhé.",
    },
    { by: "lead1", text: "@{nv02} @{nv07} sửa giúp 18 ảnh này, mỗi bạn 9 ảnh, trước 16h nha." },
    { by: "nv02", text: "Dạ em làm liền" },
    { by: "nv07", text: "Ok ạ, em lấy 9 ảnh cuối" },
  ]),
  sc("2026-09-15", "21:30", [
    { by: "lead2", text: "Ca đêm 15/9: hôm nay ổn hơn. HDR còn 280 ảnh cho cả tuần, sky còn 90 ảnh." },
    { by: "nv14", text: "Máy em lại treo lúc render panorama 😩 mở lại mất 5 phút" },
    { by: "nv14", text: "Máy em lại treo lúc render panorama 😩", gap: 1, deleted: true },
    { by: "lead2", text: "Máy 14 vẫn chưa thay RAM hả? Mai mình nhắc lại IT. Tối nay em đổi qua máy 20 nha." },
    { by: "nv14", text: "Dạ em đổi rồi ạ" },
    { by: "nv09", text: "Mình xong 30 ảnh sky, ai cần phụ không" },
    { by: "lead2", text: "Phụ @{nv14} 10 ảnh HDR giùm mình nha @{nv09}" },
  ]),
  sc("2026-09-16", "07:45", [
    {
      by: "lead1",
      text: "Đầu ca 16/9:\n- Đã giao 4/14 đơn tuần này ✅\n- Deadline hôm nay: 2 đơn HDR (310 ảnh) + 1 twilight\n- Ảnh trả về: 23 ảnh (chủ yếu trời + cửa sổ)\n\n@{nv06} @{nv04} xử lý ảnh trả về trước rồi vào HDR.",
      react: { "👍": ["nv04", "nv06"] },
    },
    { by: "nv06", text: "Dạ ok" },
  ]),
  sc("2026-09-16", "10:15", [
    {
      by: "khoa",
      text: "⚠️ Khách Sydney phàn nàn **window pull quá gắt** ở đơn 240 ảnh: cửa sổ sáng rõ như dán ảnh bên ngoài vào, viền khung cửa bị halo. Ảnh minh hoạ:",
      files: [{ name: "qc-window-pull-qua-gat.jpg", hint: "before/after: cửa sổ kéo quá gắt có halo quanh khung và cửa sổ kéo vừa phải tự nhiên" }],
      react: { "😮": ["nv08"], "👀": ["lead1", "lead2"] },
    },
    {
      by: "khoa",
      text: "Quy tắc tuần này:\n1. Cửa sổ sáng hơn tường trong phòng 1–1,5 stop là đủ\n2. Không để viền trắng quanh khung cửa\n3. Cảnh bên ngoài giữ hơi mờ, không cần sắc như chụp ngoài trời\n\nAi làm HDR tuần này đọc kỹ giúp anh.",
      react: { "👍": ["nv01", "nv05", "nv06", "nv09", "nv10", "lead1"], "🙏": ["nv08"] },
      thread: [
        { by: "nv05", text: "Anh Khoa ơi ảnh nào trong đơn đó bị phàn nàn vậy anh, để em xem có ảnh của em không", gap: 5 },
        { by: "khoa", text: "12 ảnh, anh để danh sách trong file QC. Có 3 ảnh của em, 5 ảnh ca đêm, còn lại rải rác." },
        { by: "lead2", text: "Ca đêm làm vội quá, tối nay em check kỹ hơn trước khi giao." },
        { by: "boss", text: "Gấp thì gấp nhưng đừng để khách trả về nhiều, mất uy tín lắm. Cần thì xin khách lùi 2–3 tiếng, anh duyệt.", gap: 12 },
        { by: "acc1", text: "Dạ @{boss}, account sẽ chủ động xin lùi nếu thấy không kịp." },
      ],
    },
  ]),
  sc("2026-09-16", "19:00", [
    { by: "lead2", text: "Ca đêm 16/9 bắt đầu, đã có @{nv10} @{nv11} @{nv13}. Mục tiêu tối nay: 150 ảnh HDR đơn Melbourne + check lại 12 ảnh window pull." },
    {
      by: "boss",
      text: "Anh ghé xưởng chút nha. Tối nay anh mời trà sữa cả ca chiều với ca đêm 😄",
      gap: 20,
      react: { "🎉": ["nv09", "nv10", "nv11", "nv12", "nv13"], "❤️": ["lead2"] },
    },
    { by: "nv11", text: "Sếp ghé thiệt hả 😮" },
    { by: "boss", text: "Đang trên đường, 15 phút nữa tới 😁", react: { "😂": ["nv11", "nv12"] } },
    {
      by: "lead2",
      text: "Sếp vừa ghé, cả nhóm được trà sữa với lời động viên 🥰 Cảm ơn sếp!",
      gap: 40,
      react: { "❤️": ["boss", "nv13", "nv14", "nv15", "nv09"] },
      thread: [
        { by: "nv13", text: "Sếp đứng sau lưng xem em blend cửa sổ, hồi hộp muốn xỉu 😂", gap: 3 },
        { by: "boss", text: "Blend đẹp mà, đừng run 😄", react: { "😂": ["nv13", "nv10"] } },
      ],
    },
  ]),
  sc("2026-09-17", "07:35", [
    {
      by: "lead1",
      text: "Đầu ca 17/9. Hôm qua giao đúng hạn 2 đơn HDR + twilight ✅ 12 ảnh window pull sửa xong ✅\nHôm nay còn 5 đơn: 620 ảnh. Cố gắng nha cả nhà!",
      react: { "💯": ["khoa"], "👍": ["nv01", "nv03", "nv05"] },
    },
    { by: "nv03", text: "Staging xong rồi, hôm nay em qua làm HDR nha" },
    { by: "lead1", text: "Ok @{nv03} lấy 60 ảnh đơn Adelaide nhé" },
  ]),
  sc("2026-09-17", "14:40", [
    {
      by: "nv07",
      text: "Em xin hỗ trợ ạ 🙏 Đơn twilight 60 ảnh deadline 18h, em mới xong 32, ảnh nào cũng nhiều cây phải tách trời lâu quá. Chắc không kịp ạ @{lead1}",
    },
    { by: "lead1", text: "Ok bình tĩnh. @{nv01} @{nv02} mỗi bạn lấy 10 ảnh twilight từ ảnh 33. @{nv07} làm 8 ảnh còn lại." },
    { by: "nv01", text: "Nhận ảnh 33–42" },
    { by: "nv02", text: "Mình 43–52 nha", edited: "Mình lấy 43–52 nha, 17h xong 👍" },
    { by: "acc1", text: "Nếu cần mình xin khách lùi tới 20h được nha, khách này dễ." },
    { by: "lead1", text: "Chắc kịp 18h, 17h30 mình báo lại." },
    {
      by: "lead1",
      text: "Twilight 60 ảnh xong lúc 17h25 ✅ Cảm ơn @{nv01} @{nv02} hỗ trợ!",
      gap: 160,
      react: { "👏": ["acc1", "boss"], "🙏": ["nv07"] },
      thread: [
        { by: "nv07", text: "Em cảm ơn mọi người nhiều ạ, lần sau em báo sớm hơn 🙏", gap: 2 },
        { by: "lead1", text: "Báo lúc 14h40 là vừa kịp chia rồi, vậy là tốt." },
      ],
    },
  ]),
  sc("2026-09-17", "22:15", [
    { by: "lead2", text: "Ca đêm 17/9: còn 140 ảnh HDR của 2 đơn giao sáng mai. @{nv06} @{nv10} @{nv12} đang làm. Dự kiến 1h30 xong." },
    { by: "nv12", text: "Mắt em díp lại rồi 😵 nhưng còn 18 ảnh thôi ạ" },
    { by: "lead2", text: "Ráng chút, 23h có mì 😄" },
    { by: "nv06", text: "Có mì là có động lực 😂", react: { "😂": ["nv10", "nv12", "lead2"] } },
  ]),
  sc("2026-09-18", "07:40", [
    {
      by: "lead1",
      text: "Đầu ca 18/9: ca đêm xong 2 đơn lúc 1h40 ✅ Hôm nay nhẹ hơn chút: 3 đơn, 380 ảnh. Ai mệt quá thì báo mình, đừng cố rồi ra ảnh lỗi.",
      react: { "❤️": ["nv05", "nv06", "nv08"], "👍": ["nv02"] },
    },
  ]),
  sc("2026-09-18", "12:30", [
    {
      by: "acc1",
      text: "Tin vui 🎉 Agency Sydney (đơn 240 ảnh) gửi mail khen bản sửa window pull rất tự nhiên, muốn đặt thêm 2 đơn tuần sau.\n\nTin chưa vui: khách Melbourne phản hồi 6 ảnh trời hoàng hôn **quá hồng**, cần sửa trước 17h.",
      react: { "🎉": ["lead1", "lead2", "khoa", "boss", "nv05", "nv06"], "👀": ["nv07"] },
      thread: [
        { by: "nv06", text: "Đơn 240 ảnh mà được khen, đỡ tủi ghê 🥹", gap: 4 },
        { by: "lead2", text: "Ca đêm tụi mình sửa nguyên tối đó 😄" },
        { by: "acc1", text: "Khách còn hỏi tên team để ghi vào mail cảm ơn nữa 😁", react: { "❤️": ["nv06", "lead2"] } },
      ],
    },
    { by: "khoa", text: "6 ảnh đó anh xem rồi, đúng là hồng quá. @{nv07} sửa giúp anh, giảm magenta trời, giữ cam ở chân trời." },
    { by: "nv07", text: "Dạ em nhận ạ" },
    {
      by: "boss",
      text: "Khen thì chia cho cả nhóm nha. Cảm ơn @{khoa} đã gồng QC tuần này 👍",
      react: { "❤️": ["khoa"], "👏": ["lead1", "lead2"] },
    },
  ]),
  sc("2026-09-18", "20:30", [
    {
      by: "lead2",
      text: "Ca đêm 18/9: @{nv15} lần đầu đi ca đêm, làm 40 ảnh HDR không bị QC đánh lỗi nào 👏",
      react: { "👏": ["boss", "khoa", "lead1", "nv09", "nv10", "nv11"], "🔥": ["nv12"] },
    },
    { by: "nv15", text: "Dạ em cảm ơn, nhờ @{nv10} chỉ em chọn bracket ạ 🙏" },
    { by: "nv10", text: "Bạn học nhanh mà 😄" },
  ]),
  sc("2026-09-19", "08:00", [
    { by: "lead1", text: "Thứ 7 19/9 – ngày cuối tuần cao điểm. Còn 2 đơn: 210 ảnh HDR + 40 ảnh sky. Ca sáng 8 người, mục tiêu xong hết trước 15h." },
    {
      by: "lead1",
      text: "Lưu ý quan trọng: **tối nay IT bắt đầu chuyển NAS cũ sang NAS mới**. Trước 18h mọi người upload hết file đã xong và không để file đang làm trên NAS cũ nhé.",
      gap: 2,
      react: { "👀": ["nv01", "nv04", "nv06"], "👍": ["nv05", "nv08", "lead2"] },
      thread: [
        { by: "nv04", text: "Vậy file `_wip` mình để trên máy local được không ạ?", gap: 4 },
        { by: "lead1", text: "Được, để ổ D máy mình, thứ 2 có NAS mới thì chép lên lại." },
        { by: "nv06", text: "Dạ rõ ạ" },
      ],
    },
  ]),
  sc("2026-09-19", "17:30", [
    {
      by: "boss",
      text: "Tổng kết tuần cao điểm 14–19/9 nhé cả nhà:\n- Tổng: **2.418 ảnh**, vượt kế hoạch 5%\n- 14/14 đơn giao đúng hạn, 1 đơn sớm 1 ngày\n- Tỷ lệ trả về 2,8% (cao hơn bình thường nhưng xử lý nhanh)\n- 1 agency Sydney đặt thêm 2 đơn\n\nAnh rất cảm ơn nhóm A, nhóm B, ca đêm, QC và account. Tuần sau công ty có thưởng nóng cho tuần này 🎉",
      react: {
        "🎉": ["lead1", "lead2", "khoa", "acc1", "nv01", "nv05"],
        "❤️": ["linh", "nv09", "nv10", "nv15"],
        "👏": ["acc2", "nv03", "nv07"],
      },
      thread: [
        { by: "lead1", text: "Cảm ơn @{boss}! Nhóm A ai cũng mệt nhưng vui lắm ạ 🥹", gap: 4 },
        { by: "lead2", text: "Ca đêm tụi em xin 1 buổi ngủ bù được không sếp 😂" },
        { by: "boss", text: "Thứ 2 ca đêm vào trễ đến 10h như chị Linh đã báo nhé 😄" },
        { by: "nv10", text: "Thưởng nóng là nóng cỡ nào sếp ơi 🔥" },
        { by: "boss", text: "Đủ nóng để đi Vũng Tàu cuối tháng uống thêm vài ly 😂", react: { "😂": ["nv10", "nv09", "lead2", "nv06"] } },
        { by: "linh", text: "Chị cũng cảm ơn cả nhà, tuần này ai cũng xuất sắc 👏" },
      ],
    },
  ]),
  sc("2026-09-19", "21:00", [
    { by: "lead2", text: "Ca đêm cuối 19/9: xong hết, đơn cuối giao lúc 20h50 ✅ Mọi người lưu file local rồi tắt máy nha, IT đang chuyển NAS." },
    { by: "nv11", text: "Xong tuần cao điểm rồi 🥳" },
    { by: "nv09", text: "Về ngủ 12 tiếng thôi 😴", react: { "😂": ["nv11", "lead2", "nv10"] } },
  ]),

  // ── Sun 20/9 (ca trực) – Mon 21/9: NAS migration ────────────────────────────────────────────────
  sc("2026-09-20", "09:30", [
    { by: "lead2", text: "Ca trực chủ nhật 20/9: mình với @{nv12} @{nv15}. NAS đang chuyển nên tạm làm trên ổ D, gửi file cho khách qua link upload của account." },
    { by: "nv12", text: "Đơn wedding 20 ảnh em làm trên máy local nha" },
    {
      by: "acc2",
      text: "Mình tạo link upload tạm cho đơn hôm nay rồi, để trong thread này.",
      gap: 15,
      thread: [
        { by: "acc2", text: "Link: [upload-tam-20-09](https://nesso.example/upload/tam-20-09)", gap: 1 },
        { by: "nv15", text: "Dạ em thấy rồi ạ" },
      ],
    },
    { by: "nv15", text: "Em làm 30 ảnh HDR khách Mỹ ạ, 15h xong" },
  ]),
  sc("2026-09-21", "07:40", [
    {
      by: "lead1",
      text: "⚠️ Đầu ca 21/9: NAS mới chưa vào được share SanXuat, báo 'Access denied'. Mọi người đừng copy lung tung, mình đã báo anh Minh bên kênh IT.",
      files: [{ name: "loi-nas-access-denied.png", hint: "screenshot Windows Explorer: không mở được thư mục SanXuat trên NAS mới, hộp thoại Access denied" }],
      react: { "😮": ["nv03", "nv08"], "👀": ["khoa", "lead2"] },
    },
    { by: "nv06", text: "Em vào được folder Done nhưng không vào được Input ạ" },
    { by: "nv08", text: "Em không thấy ổ Z luôn ạ 😢" },
    { by: "nv01", text: "Máy mình vào được hết, chắc do quyền theo nhóm?" },
    {
      by: "lead1",
      text: "Chắc phân quyền nhóm A/B chưa đúng. Ai bị thì reply số máy trong thread này để mình gửi IT.",
      thread: [
        { by: "nv06", text: "Máy 06", gap: 1 },
        { by: "nv08", text: "Máy 08, không thấy ổ Z" },
        { by: "nv03", text: "Máy 03 cũng Access denied ạ", edited: "Máy 03 cũng Access denied, vào được Done nhưng không vào Input ạ" },
        { by: "nv04", text: "Máy 04 ạ" },
      ],
    },
    { by: "khoa", text: "Ảnh đơn sáng nay anh tải về máy QC từ link khách rồi, ai cần lấy tạm thì qua máy anh copy nhé." },
  ]),
  sc("2026-09-21", "10:30", [
    { by: "lead1", text: "Update NAS: anh Minh sửa quyền cho nhóm A rồi, mọi người thử vào lại ổ Z giúp mình. Nhóm B chiều vào thử rồi báo lại nhé @{lead2}." },
    { by: "nv08", text: "Em vào được rồi ạ ✅" },
    { by: "nv03", text: "Vào được nhưng folder 2026-09 trống trơn ạ 😮" },
    { by: "lead1", text: "Folder tháng 9 đang copy nốt, khoảng 11h xong. Làm đơn hôm nay trước, cần file cũ thì nhắn mình." },
    { by: "nv06", text: "Ok ạ, em làm đơn mới trước" },
  ]),
  sc("2026-09-21", "16:00", [
    { by: "lead1", text: "Bàn giao 21/9: sáng mất 1 tiếng vì NAS nhưng đã bù lại, 3 đơn giao đúng hạn ✅ @{lead2} ca chiều thử quyền nhóm B trên NAS mới nha." },
    { by: "lead2", text: "Nhóm B vào được rồi, chỉ còn @{nv14} bị lỗi quyền ghi, đã báo IT." },
    { by: "nv14", text: "Em đọc được file nhưng không lưu được vào Done ạ" },
    { by: "lead2", text: "Tạm lưu ổ D, IT sửa xong thì chép lên." },
    {
      by: "nv14",
      text: "Lưu được rồi ạ, anh Minh vừa sửa xong 👍",
      gap: 35,
    },
  ]),

  // ── Tue 22/9 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-22", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 22/9: NAS ổn định rồi ✅ Hôm nay:\n- HDR 2 đơn mới của agency Sydney (đơn khen tuần trước): 180 ảnh\n- Sky replacement: 45 ảnh\n- Object removal: 30 ảnh\n\n@{nv05} @{nv06} @{nv01} HDR, @{nv02} sky, @{nv04} @{nv08} object removal.",
      react: { "👍": ["nv01", "nv02", "nv04", "nv05", "nv06", "nv08"] },
    },
    { by: "nv02", text: "Sky đơn này dùng preset mới của anh Khoa luôn hả ạ?" },
    { by: "khoa", text: "Ừ, bộ 'Soft Blue' với 'Light Cloud', đừng dùng 'Clear Blue' nữa nha." },
  ]),
  sc("2026-09-22", "15:10", [
    {
      by: "khoa",
      text: "Tổng kết QC tuần cao điểm:\n- Trả về: 68/2.418 ảnh (2,8%)\n- Lỗi nhiều nhất: trời bão hoà (24), window pull gắt/halo (21), ám màu tường (11), sót vật thể khi xoá (7), khác (5)\n\nTuần này anh cập nhật preset trời và checklist QC. Cảm ơn mọi người đã sửa nhanh.",
      files: [{ name: "bao-cao-qc-tuan-cao-diem-14-19-09.pdf", hint: "báo cáo QC tuần 14–19/9: số ảnh trả về theo loại lỗi, biểu đồ cột, top lỗi" }],
      react: { "👍": ["lead1", "lead2", "boss"], "👀": ["nv02", "nv07"] },
      thread: [
        { by: "boss", text: "Cảm ơn Khoa. Lỗi trời với window pull chiếm gần 70%, mình training lại 1 buổi được không?", gap: 20 },
        { by: "khoa", text: "Dạ được sếp, em đề xuất thứ 5 này 15h cho cả 2 nhóm." },
        { by: "lead2", text: "Thứ 5 15h nhóm B vừa vào ca, ok ạ." },
        { by: "linh", text: "Chị đặt phòng họp lớn nhé." },
      ],
    },
  ]),
  // ── Wed 23/9 — sinh nhật chị Linh ──────────────────────────────────────────────────────────────
  sc("2026-09-23", "07:50", [
    {
      by: "lead1",
      text: "Đầu ca 23/9. Hôm nay sinh nhật chị Linh, nhóm A ký thiệp ở bàn mình nha 🎂\n\nViệc: HDR Sydney còn 70 ảnh, twilight mới 30 ảnh (@{nv07}), virtual staging 18 ảnh (@{nv03}).",
      react: { "🎉": ["nv02", "nv03", "nv05"], "❤️": ["linh"] },
    },
    { by: "linh", text: "Ơ sao biết hay vậy 😆 Cảm ơn cả nhà nhé!", gap: 20, react: { "❤️": ["lead1", "nv04", "nv08"] } },
    { by: "nv07", text: "Twilight đơn này có note riêng không ạ @{acc1}?" },
    { by: "acc1", text: "Như đơn Melbourne tuần trước nha, trời xanh đậm, đèn vàng ấm vừa phải." },
  ]),
  sc("2026-09-23", "19:30", [
    { by: "lead2", text: "Ca chiều 23/9: staging 18 ảnh @{nv13} làm tiếp xong 10. Khách Mỹ vừa gửi thêm 12 ảnh object removal, deadline 7h sáng mai giờ New York = 18h mai bên mình, không gấp." },
    { by: "nv13", text: "Staging còn 8 ảnh phòng ngủ, em làm tới 21h30 ạ" },
    { by: "nv11", text: "Object removal để mình nha, tối nay làm 6 ảnh" },
    { by: "lead2", text: "Ok 👍" },
  ]),

  // ── Thu 24/9 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-24", "08:05", [
    {
      by: "lead1",
      text: "Đầu ca 24/9:\n- Staging 18 ảnh: giao rồi ✅\n- HDR mới khách Úc: 95 ảnh, deadline 6h sáng mai\n- 15h training QC với anh Khoa ở phòng họp lớn, nhóm A ai xong việc thì vào\n\n@{nv01} @{nv05} @{nv06} @{nv08} chia HDR nhé.",
      react: { "✅": ["nv01", "nv05", "nv06"] },
    },
    { by: "nv08", text: "Em vào training được không ạ, phần window pull em còn yếu" },
    { by: "lead1", text: "Vào đi em, phần HDR của em ca chiều @{nv10} đỡ 10 ảnh." },
  ]),
  sc("2026-09-24", "11:20", [
    {
      by: "acc2",
      text: "Khách Mỹ đơn staging hôm qua phản hồi: thích tổng thể nhưng muốn **đổi sofa xám sang sofa da nâu** ở 4 ảnh phòng khách, thêm cây xanh góc phòng. @{nv03} @{nv13} ai làm phòng khách vậy?",
    },
    { by: "nv03", text: "Phòng khách là em làm ạ, em sửa liền" },
    { by: "acc2", text: "Khách cần trước 9h sáng mai giờ New York, không gấp lắm" },
    {
      by: "nv03",
      text: "Em sửa xong 4 ảnh rồi, preview đây ạ",
      gap: 50,
      files: [{ name: "staging-sofa-da-nau-preview.jpg", hint: "virtual staging phòng khách: sofa da nâu, cây xanh góc phòng, sàn gỗ sáng, tường trắng" }],
    },
    { by: "acc2", text: "Đẹp đó, mình gửi khách luôn 👍", react: { "👍": ["nv03"], "❤️": ["nv13"] } },
  ]),
  sc("2026-09-24", "16:40", [
    {
      by: "khoa",
      text: "Cảm ơn mọi người đi training. Slide hôm nay anh để ở đây, ai ca chiều chưa nghe kịp thì xem lại nha.",
      files: [{ name: "training-qc-troi-va-window-pull.pdf", hint: "slide training QC: chọn trời tự nhiên, window pull 1–1,5 stop, tránh halo, ví dụ đúng/sai" }],
      react: { "🙏": ["nv08", "nv12", "nv14"], "👍": ["lead1", "lead2"] },
    },
    { by: "nv12", text: "Phần ví dụ halo dễ hiểu lắm ạ 👍" },
    { by: "boss", text: "Buổi training tốt, tuần sau anh xem số trả về có giảm không nhé 😄", react: { "😂": ["khoa"], "👍": ["linh"] } },
  ]),

  // ── Fri 25/9 — Trung thu ────────────────────────────────────────────────────────────────────────
  sc("2026-09-25", "07:45", [
    {
      by: "lead1",
      text: "Đầu ca 25/9 – Trung thu 🥮\n- 16h30 công ty có tiệc trung thu + phát bánh ở sảnh tầng 1\n- Ca sáng cố chốt đơn trước 16h\n- Ca chiều @{lead2} sắp xếp luân phiên xuống tiệc, không để trống máy đơn gấp nha",
      react: { "🎉": ["nv01", "nv02", "nv04", "nv08", "nv15"], "👍": ["lead2"] },
      thread: [
        { by: "nv12", text: "Ca chiều xuống trễ có còn bánh không ạ 😢", gap: 20 },
        { by: "lead1", text: "Còn nha, chị Linh để riêng phần ca chiều với ca đêm rồi 😄", react: { "❤️": ["nv12", "nv13"] } },
      ],
    },
    { by: "lead2", text: "Ok, nhóm B chia 2 đợt 16h30 và 17h nhé." },
    { by: "nv08", text: "Bánh nhân gì vậy ạ 😋" },
    { by: "nv02", text: "Nghe nói có thập cẩm với đậu xanh 😁" },
  ]),
  sc("2026-09-25", "16:10", [
    {
      by: "lead1",
      text: "Bàn giao 25/9: đơn hôm nay giao xong hết ✅ không có tồn. Xuống tiệc thôi cả nhà 🥮🏮",
      react: { "🎉": ["boss", "linh", "nv03", "nv05", "nv06"], "😂": ["nv07"] },
    },
    { by: "lead2", text: "Nhóm B đợt 1: @{nv09} @{nv11} @{nv14}. Đợt 2: @{nv10} @{nv12} @{nv13} @{nv15}." },
    { by: "nv15", text: "Dạ em đợt 2 ạ" },
  ]),

  // ── Sat 26/9 — nhiều bạn đi Vũng Tàu ───────────────────────────────────────────────────────────
  sc("2026-09-26", "08:00", [
    { by: "lead2", text: "Thứ 7 26/9: nhiều bạn đi Vũng Tàu, ca sáng hôm nay mình trực thay @{lead1}. Có mặt: @{nv06} @{nv10} @{nv11} @{nv14}. Hôm nay 2 đơn HDR, 110 ảnh." },
    { by: "nv06", text: "Có mặt ạ ✋" },
    {
      by: "nv10",
      text: "Mấy người đi biển nhớ gửi hình về cho ca trực ghen tị nha 😂",
      react: { "😂": ["nv11", "nv14", "lead2"] },
    },
    {
      by: "lead1",
      text: "Đang trên xe nè, cảm ơn @{lead2} trực giùm 🙏 Có gì cứ tag mình.",
      gap: 30,
    },
  ]),
  sc("2026-09-26", "15:00", [
    { by: "lead2", text: "Ca trực 26/9: 2 đơn HDR giao xong ✅ Mọi người về sớm nha." },
    {
      by: "boss",
      text: "Cảm ơn ca trực, anh ở Vũng Tàu vẫn đọc tin 😄 Tối anh gửi hình biển cho ghen tị nè.",
      gap: 25,
      react: { "😂": ["nv10", "nv14", "nv06"], "❤️": ["lead2"] },
    },
  ]),

  // ── Mon 28/9 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-28", "07:50", [
    {
      by: "lead1",
      text: "Đầu tuần 28/9 sau chuyến đi 🏖️ Mọi người lấy lại tinh thần nha!\n- Tồn: 3 đơn, 240 ảnh\n- Gấp: HDR 90 ảnh trước 13h\n\n@{nv05} @{nv01} @{nv08} HDR gấp. @{nv02} @{nv07} sky + dusk. @{nv03} staging. @{nv04} object removal.",
      react: { "👍": ["nv01", "nv04", "nv07"], "😂": ["nv02"] },
    },
    {
      by: "nv05",
      text: "Chân còn cát Vũng Tàu mà vô làm HDR luôn 😂",
      react: { "😂": ["nv01", "nv08", "lead1"] },
    },
  ]),
  sc("2026-09-28", "14:00", [
    {
      by: "acc1",
      text: "Đơn mới tuần này:\n- Agency Sydney (khách khen): 2 đơn, 260 ảnh HDR\n- Agency Perth mới: thử 30 ảnh sky + dusk\n- Khách Mỹ cũ: 40 ảnh staging\n\nĐơn Perth là khách mới, làm thật kỹ giúp mình nha @{lead1} @{lead2}.",
      react: { "👀": ["lead1", "lead2", "khoa"] },
    },
    { by: "lead2", text: "Đơn Perth để @{nv09} với @{nv11} làm, hai bạn ít bị trả về nhất nhóm B." },
    { by: "nv11", text: "Dạ em nhận ạ" },
    {
      by: "khoa",
      text: "Đơn khách mới anh QC 100%, xong ảnh nào upload ảnh đó nha.",
      react: { "👍": ["nv09", "nv11"] },
    },
  ]),

  // ── Tue 29/9 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-09-29", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 29/9: hôm qua giao 3 đơn ✅ Hôm nay HDR agency Sydney 130 ảnh (@{nv01} @{nv05} @{nv06} @{nv08}), staging khách Mỹ 40 ảnh (@{nv03} sáng, @{nv13} chiều).",
      react: { "👍": ["nv06", "nv03"] },
    },
    { by: "nv06", text: "Ok ạ" },
    { by: "nv03", text: "Staging em làm phòng khách trước, phòng ngủ để @{nv13} nha" },
  ]),
  sc("2026-09-29", "20:15", [
    {
      by: "lead2",
      text: "Ca chiều 29/9: đơn Perth 30 ảnh xong, @{khoa} QC pass hết ✅ Khách mới mà không lỗi ảnh nào, khen @{nv09} @{nv11} 👏",
      react: { "👏": ["boss", "lead1", "acc1", "nv10", "nv13"], "🔥": ["nv12"] },
    },
    { by: "nv09", text: "Dạ nhờ preset trời mới của anh Khoa đó ạ 😁" },
    { by: "khoa", text: "Preset chỉ 50% thôi, còn lại là tay nghề 👍", react: { "❤️": ["nv09", "nv11"] } },
    { by: "nv10", text: "Ai có link album hình Vũng Tàu không, gửi mình với", deleted: true },
    { by: "nv10", text: "Nhầm kênh 😅 xin lỗi cả nhà", react: { "😂": ["nv09", "nv12"] } },
  ]),

  // ── Wed 30/9 — chốt quý 3 ──────────────────────────────────────────────────────────────────────
  sc("2026-09-30", "08:10", [
    {
      by: "linh",
      text: "Hôm nay chốt quý 3. Hai trưởng ca gửi giúp chị số liệu sản lượng tháng 7–8–9 theo nhóm (số ảnh, số đơn, tỷ lệ trả về) trước 15h nhé @{lead1} @{lead2}.",
    },
    { by: "lead1", text: "Dạ chị, trưa em gửi." },
    { by: "lead2", text: "Em xuất từ file theo dõi, gửi chị trước 14h ạ." },
    {
      by: "lead1",
      text: "Số liệu nhóm A quý 3 đây chị.",
      gap: 240,
      files: [{ name: "san-luong-nhom-A-Q3-2026.xlsx", hint: "sản lượng nhóm A tháng 7, 8, 9: số đơn, số ảnh, tỷ lệ trả về, theo từng nhân viên" }],
    },
    {
      by: "lead2",
      text: "Nhóm B đây ạ.",
      gap: 25,
      files: [{ name: "san-luong-nhom-B-Q3-2026.xlsx", hint: "sản lượng nhóm B tháng 7, 8, 9 kèm số ảnh ca đêm tuần cao điểm" }],
    },
    { by: "linh", text: "Cảm ơn hai em 👍", react: { "👍": ["lead1", "lead2"] } },
  ]),
  sc("2026-09-30", "16:00", [
    {
      by: "boss",
      text: "Quý 3 nhóm sản xuất ra tổng cộng hơn **28.000 ảnh**, tăng 18% so với quý 2, tỷ lệ trả về trung bình 2,1%. Cảm ơn tất cả các em. Quý 4 mình đặt mục tiêu **giảm trả về xuống dưới 1,5%** nhé 💪",
      react: {
        "👏": ["lead1", "lead2", "khoa", "linh", "acc1", "acc2"],
        "🎉": ["nv01", "nv05", "nv09", "nv10"],
        "💯": ["nv03"],
      },
      thread: [
        { by: "khoa", text: "Dạ sếp, tuần sau em ra checklist QC v2 để hỗ trợ mục tiêu này.", gap: 5 },
        { by: "lead1", text: "Nhóm A sẽ cố ạ 💪" },
        { by: "nv12", text: "Dưới 1,5% hơi căng nhưng làm được ạ 😄" },
        { by: "boss", text: "Anh tin là được 👍" },
      ],
    },
  ]),

  // ── Thu 1/10 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-10-01", "07:45", [
    {
      by: "lead1",
      text: "Đầu ca 1/10 – chào tháng mới 🍂\n- HDR agency Sydney: 130 ảnh (đơn thứ 2)\n- Twilight: 22 ảnh\n- Ảnh trả về: 4 ảnh\n\n@{nv07} twilight, @{nv02} sửa 4 ảnh trả về, còn lại vào HDR.",
      react: { "👍": ["nv02", "nv07", "nv05"] },
    },
    { by: "nv02", text: "4 ảnh trả về lần này lỗi gì vậy ạ?" },
    { by: "khoa", text: "2 ảnh sót ổ cắm trên tường, 2 ảnh cột nhà nghiêng. Dễ thôi em." },
  ]),
  sc("2026-10-01", "13:40", [
    {
      by: "acc2",
      text: "Khách Mỹ (agency ở California) gửi **virtual staging 24 ảnh** + **object removal 15 ảnh**, deadline 8h sáng thứ 2 giờ California. Style staging: **mid-century modern**, tông gỗ óc chó, điểm màu mù tạt.",
      react: { "👀": ["nv13", "lead2"] },
    },
    { by: "lead2", text: "@{nv13} staging, @{nv14} object removal nha." },
    {
      by: "nv13",
      text: "Mid-century thì sofa chân gỗ thon, ghế bành bọc da đúng không ạ?",
      thread: [
        { by: "acc2", text: "Đúng rồi, nhưng đừng dùng đồ có logo hay thương hiệu rõ nha.", gap: 3 },
        { by: "nv13", text: "Dạ ok ạ 👍" },
      ],
    },
    { by: "nv14", text: "Em nhận object removal ạ 👍" },
  ]),
  sc("2026-10-01", "20:40", [
    { by: "lead2", text: "Ca chiều 1/10: staging California @{nv13} xong 8/24, object removal @{nv14} xong 15/15 ✅" },
    { by: "nv14", text: "Có 2 ảnh khách muốn xoá cả cái xe cẩu bên kia đường, em xoá luôn rồi nha" },
    { by: "lead2", text: "Ok, nhớ check lại phần bóng đổ dưới đường chỗ xe cũ nhé." },
  ]),

  // ── Fri 2/10 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-10-02", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 2/10: HDR Sydney xong 90/130, sáng nay làm nốt. @{nv04} @{nv08} hôm nay thử làm cut-out sản phẩm cùng @{nv11} để chuẩn bị cho khách mới tuần sau nhé.",
      react: { "👀": ["nv04", "nv08"] },
    },
    { by: "nv08", text: "Em chưa làm cut-out bao giờ, có tài liệu không ạ?" },
    {
      by: "khoa",
      text: "Có, hướng dẫn clipping path cơ bản đây: [Hướng dẫn cut-out](https://nesso.example/wiki/cut-out-co-ban)",
      react: { "🙏": ["nv08", "nv04"] },
      thread: [
        { by: "nv04", text: "Phần ly thuỷ tinh có trong tài liệu không anh?", gap: 10 },
        { by: "khoa", text: "Có ở mục 4, đọc kỹ phần giữ độ trong và bóng đổ nha." },
        { by: "nv11", text: "Chiều mình vào chỉ thêm trực tiếp cho 2 bạn nha 😄", react: { "🙏": ["nv04", "nv08"] } },
      ],
    },
  ]),
  sc("2026-10-02", "21:00", [
    { by: "lead2", text: "Ca chiều 2/10: staging California xong 14/24, object removal xong hết. Mai thứ 7 @{nv13} làm nốt." },
    { by: "nv13", text: "Dạ, mai em vào ca sáng làm luôn ạ" },
    { by: "nv12", text: "Hôm nay ít đơn, ngồi luyện cut-out với @{nv11} 😄" },
    { by: "nv11", text: "Học nhanh lắm, mai làm thật luôn được 😆", react: { "😂": ["nv12", "lead2"] } },
  ]),

  // ── Sat 3/10 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-10-03", "08:10", [
    {
      by: "lead1",
      text: "Thứ 7 3/10: ca sáng 6 người. Staging California (@{nv13}), HDR mới 60 ảnh khách Úc (@{nv05} @{nv06}). Lưu ý: **từ mai 4/10 Sydney/Melbourne sang giờ mùa hè**, lệch với mình 4 tiếng thay vì 3. Deadline 9h sáng Sydney = **5h sáng VN** nha!",
      react: { "👀": ["nv05", "nv06", "lead2", "acc1"], "😮": ["nv08"] },
    },
    {
      by: "acc1",
      text: "Đúng rồi, account đã cập nhật giờ trong file theo dõi đơn. Riêng Brisbane không đổi giờ nha, vẫn lệch 3 tiếng.",
      edited: "Đúng rồi, account đã cập nhật giờ trong file theo dõi đơn. Riêng **Brisbane không đổi giờ** nha, vẫn lệch 3 tiếng.",
    },
    { by: "nv06", text: "Rối ghê 😅 May là có file" },
  ]),
  sc("2026-10-03", "13:45", [
    { by: "nv13", text: "Staging California 24/24 xong ✅ @{acc2} check giúp em trước khi gửi khách nha" },
    { by: "acc2", text: "Đẹp lắm, đúng mood mid-century. Gửi khách luôn nè 👍", gap: 20 },
    { by: "lead2", text: "Giao trước deadline gần 2 ngày luôn 👏" },
  ]),
  // ── Mon 5/10 — Q4 kickoff, checklist QC v2, khách Nhật thử nghiệm cut-out ─────────────────────────
  sc("2026-10-05", "07:30", [
    {
      by: "lead1",
      text: "## Đầu ca 5/10 – khởi động quý 4\n- Áp dụng **checklist QC v2** từ hôm nay (anh Khoa hướng dẫn lúc 9h)\n- Deadline Sydney/Melbourne giờ là **5h sáng VN** (giờ mùa hè)\n- Đơn hôm nay: 3 HDR (280 ảnh), 1 sky (40 ảnh), 1 staging (20 ảnh)\n\nPhân job trong file đính kèm.",
      edited: "## Đầu ca 5/10 – khởi động quý 4\n- Áp dụng **checklist QC v2** từ hôm nay (anh Khoa hướng dẫn lúc **10h**)\n- Deadline Sydney/Melbourne giờ là **5h sáng VN** (giờ mùa hè)\n- Đơn hôm nay: 3 HDR (280 ảnh), 1 sky (40 ảnh), 1 staging (20 ảnh)\n\nPhân job trong file đính kèm.",
      files: [{ name: "phan-job-05-10.xlsx", hint: "phân job 5/10 theo nhóm A/B, cột deadline giờ Sydney (giờ mùa hè) và giờ VN" }],
      react: { "👍": ["nv01", "nv02", "nv05", "nv06", "lead2"], "✅": ["nv03"] },
    },
    {
      by: "nv01",
      text: "Lương về rồi, đầu tuần làm hăng hẳn 😂",
      react: { "😂": ["nv02", "nv05", "nv08", "lead1"] },
    },
    { by: "nv07", text: "Sky 40 ảnh em nhận nha, đơn này khách Brisbane hay Sydney ạ?" },
    { by: "lead1", text: "Brisbane, hạn 6h sáng mai vì Brisbane không đổi giờ." },
  ]),
  sc("2026-10-05", "10:00", [
    {
      by: "khoa",
      text: "## Checklist QC v2 (áp dụng từ 5/10)\nMỗi ảnh trước khi upload Done tự check:\n[ ] Đường thẳng đứng thẳng, chân trời cân\n[ ] Cửa sổ sáng hơn tường 1–1,5 stop, không halo\n[ ] Tường/trần trắng trung tính, không ám màu\n[ ] Trời đúng preset khách, không bão hoà\n[ ] Đã xoá đủ vật thể theo note\n[ ] Đúng kích thước & định dạng xuất\n\nChi tiết + ảnh ví dụ: [Checklist QC v2](https://nesso.example/wiki/qc-checklist-v2)",
      react: { "👍": ["lead1", "lead2", "nv01", "nv05", "nv09"], "💯": ["boss", "linh"] },
      thread: [
        { by: "nv08", text: "Checklist này mình tự tick hay có form riêng ạ?", gap: 6 },
        { by: "khoa", text: "Tự check thôi em, cuối ngày trưởng ca random 10 ảnh/người để đối chiếu." },
        { by: "lead2", text: "Nhóm B in ra dán cạnh màn hình luôn nha các bạn 😄" },
        { by: "nv15", text: "Em in rồi ạ ✅" },
      ],
    },
  ]),
  sc("2026-10-05", "14:30", [
    {
      by: "acc1",
      text: "📌 Khách mới: **khách Nhật thử nghiệm cut-out** – 50 ảnh sản phẩm (đồ gốm, ly thuỷ tinh), nền trắng thuần, **viền phải cực sạch**, giữ bóng đổ tự nhiên. Deadline 10h sáng thứ 4 giờ Tokyo = 8h sáng VN.\n\nẢnh mẫu khách yêu cầu:",
      files: [{ name: "khach-nhat-mau-cut-out.jpg", hint: "ảnh mẫu khách gửi: ly thuỷ tinh và chén gốm cut-out nền trắng thuần, viền sạch, bóng đổ mềm" }],
      react: { "👀": ["lead2", "khoa", "nv11", "nv14"], "😮": ["nv12"] },
    },
    { by: "lead2", text: "@{nv11} @{nv14} nhận đơn này nhé, hai bạn làm cut-out kỹ nhất nhóm." },
    { by: "nv11", text: "Ly thuỷ tinh trong suốt thì phải giữ phần nền xuyên qua ly đúng không ạ?" },
    { by: "acc1", text: "Đúng, khách muốn thấy độ trong của ly, không được biến thành ly đục." },
    {
      by: "khoa",
      text: "Đơn này anh QC zoom 200% từng ảnh nha. Feather viền không quá 0,5px.",
      react: { "👀": ["nv11", "nv14"], "👍": ["lead2"] },
    },
    {
      by: "boss",
      text: "Khách Nhật khó tính nhưng làm tốt là đơn đều lắm. Tập trung giúp anh nhé @{lead2} @{khoa}.",
      react: { "🙏": ["lead2", "khoa"], "👍": ["acc1"] },
    },
  ]),
  sc("2026-10-05", "20:30", [
    { by: "lead2", text: "Ca chiều 5/10: cut-out khách Nhật @{nv11} @{nv14} xong 20/50, gửi @{khoa} QC sáng mai. HDR 3 đơn xong hết ✅" },
    { by: "nv14", text: "Ly thuỷ tinh khó thật sự 😵 phần miệng ly tách mãi không mượt" },
    { by: "nv11", text: "Zoom 300% rồi đi Pen từng đoạn ngắn, đừng vội nha bạn" },
  ]),

  // ── Tue 6/10 — sinh nhật lead1 ──────────────────────────────────────────────────────────────────
  sc("2026-10-06", "07:50", [
    {
      by: "nv05",
      text: "Chúc mừng sinh nhât trưởng ca @{lead1} 🎉 Chúc tuổi mới khoẻ, ít đơn gấp, nhiều đơn dễ ạ!",
      edited: "Chúc mừng sinh nhật trưởng ca @{lead1} 🎉 Chúc tuổi mới khoẻ, ít đơn gấp, nhiều đơn dễ ạ!",
      react: { "🎉": ["nv01", "nv02", "nv03", "nv04", "nv06", "nv07", "nv08", "lead2"], "❤️": ["boss", "linh", "lead1"] },
      thread: [
        { by: "nv02", text: "HPBD nha 🎉", gap: 2 },
        { by: "lead2", text: "Chúc mừng sinh nhật nha, tối nay ca chiều giữ phần bánh 😄" },
        { by: "boss", text: "Happy birthday em, cảm ơn em đã giữ nhóm A chạy đều 👍", gap: 12 },
        { by: "lead1", text: "Cảm ơn mọi người, cảm ơn @{boss} nhiều nha 🥹 Trưa nay mình mời nhóm A trà sữa!", react: { "🎉": ["nv04", "nv08", "nv05"] } },
      ],
    },
    {
      by: "lead1",
      text: "Đầu ca 6/10 (cảm ơn cả nhà ❤️):\n- HDR Melbourne: 110 ảnh, deadline 5h sáng mai\n- Cut-out khách Nhật: sáng @{nv04} @{nv08} làm phụ 10 ảnh đơn giản (chén gốm), chiều @{nv11} @{nv14} làm tiếp\n- Sky 40 ảnh: @{nv02}",
      gap: 10,
      react: { "👍": ["nv04", "nv08", "nv02"] },
    },
  ]),
  sc("2026-10-06", "15:00", [
    {
      by: "khoa",
      text: "Cut-out khách Nhật batch 1 (20 ảnh): QC thấy 6 ảnh **viền răng cưa** ở miệng ly và quai cốc. Ảnh zoom đây:",
      files: [{ name: "qc-cut-out-vien-rang-cua.png", hint: "zoom 200% viền miệng ly thuỷ tinh bị răng cưa so với viền mượt đúng chuẩn" }],
      react: { "👀": ["nv11", "nv14", "lead2"] },
      thread: [
        { by: "nv11", text: "Phần bóng đổ khách có góp ý gì không anh?", gap: 4 },
        { by: "khoa", text: "Chưa, anh thấy bóng ổn. Chỉ lỗi viền thôi." },
        { by: "acc1", text: "Mình giữ batch 1 lại chưa gửi khách, chờ bản sửa nha." },
      ],
    },
    { by: "khoa", text: "Dùng Pen Tool, không dùng Quick Selection cho đơn này. Đường cong miệng ly kéo handle mượt, ít điểm neo." },
    { by: "nv14", text: "Dạ 4 ảnh trong đó là của em, em làm lại bằng Pen ạ 🙏" },
    { by: "nv08", text: "2 ảnh còn lại của em, em sửa liền ạ" },
    { by: "khoa", text: "Ok, sửa xong gửi anh trước 18h.", react: { "👍": ["nv08", "nv14"] } },
  ]),
  sc("2026-10-06", "21:15", [
    { by: "lead2", text: "Ca chiều 6/10: cut-out khách Nhật 50/50 xong, 6 ảnh viền sửa lại @{khoa} đã pass ✅ Account gửi khách sáng mai 7h45." },
    { by: "nv14", text: "Làm bằng Pen lâu gấp đôi mà nhìn sướng mắt hẳn 😄" },
    { by: "lead2", text: "Giữ phong độ này nha. Ai còn dở HDR Melbourne thì báo số còn lại giúp mình." },
    { by: "nv10", text: "Còn 6 ảnh, 22h xong ạ" },
    { by: "nv15", text: "Em còn 4 ảnh ạ" },
  ]),

  // ── Wed 7/10 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-10-07", "08:00", [
    {
      by: "lead1",
      text: "Đầu ca 7/10:\n- Cut-out khách Nhật: 50/50 đã giao lúc 7h45 ✅ (sớm 15 phút)\n- HDR Melbourne: giao 4h50 ✅\n- Hôm nay: HDR 2 đơn (190 ảnh), object removal 25 ảnh\n\n@{nv01} @{nv05} @{nv06} @{nv03} HDR, @{nv04} object removal.",
      react: { "👏": ["boss", "acc1", "nv11", "nv14"], "👍": ["nv05"] },
      thread: [
        { by: "nv11", text: "Khách Nhật có phản hồi gì chưa ạ? 👀", gap: 25 },
        { by: "acc1", text: "Chưa, giờ Tokyo mới 10h, chiều chắc có nha." },
      ],
    },
    { by: "nv04", text: "Dạ em nhận object removal ạ" },
  ]),
  sc("2026-10-07", "11:30", [
    { by: "nv05", text: "Đơn HDR Sydney khách ghi 96 ảnh mà folder chỉ có 90 bộ bracket ạ, thiếu từ IMG_2201 đến 2206. @{acc1} xin giúp em file gốc với ạ" },
    { by: "acc1", text: "Để mình hỏi khách, bên đó giờ là 3h30 chiều, chắc trả lời nhanh." },
    {
      by: "acc1",
      text: "Khách nói 6 ảnh đó họ bỏ, chỉ làm 90 thôi nha. Mình cập nhật lại file theo dõi rồi.",
      gap: 30,
      react: { "👍": ["nv05", "lead1"] },
    },
    { by: "nv05", text: "Dạ ok ạ, may mà hỏi trước 😅" },
  ]),
  sc("2026-10-07", "19:30", [
    {
      by: "lead2",
      text: "Ca chiều 7/10: khách Nhật phản hồi sơ bộ: **47/50 ảnh đạt**, 3 ảnh cần chỉnh bóng đổ mềm hơn. Khách sẽ gửi batch 2 (80 ảnh) nếu bản sửa đạt 😮",
      react: { "🎉": ["nv11", "nv14", "nv12"], "😮": ["nv13"] },
    },
    { by: "nv11", text: "3 ảnh bóng đổ em sửa liền tối nay ạ" },
    { by: "acc1", text: "Khách cần bản sửa trước 10h sáng mai giờ Tokyo, tức 8h VN nha." },
    { by: "nv11", text: "Xong 3 ảnh rồi ạ, @{khoa} check giúp em", gap: 45 },
    { by: "khoa", text: "Ổn rồi em, bóng mềm hơn nhiều 👍", gap: 15 },
  ]),

  // ── Thu 8/10 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-10-08", "07:45", [
    {
      by: "lead1",
      text: "Đầu ca 8/10:\n- 3 ảnh sửa khách Nhật đã gửi 7h30 ✅\n- HDR Sydney: 150 ảnh, deadline 5h sáng mai\n- Twilight 30 ảnh: @{nv07} @{nv02}\n\nNhắc lại: tick checklist QC v2 trước khi upload Done nha. Hôm qua random check nhóm A còn 3 ảnh quên chỉnh đường dọc.",
      react: { "👍": ["nv02", "nv07", "khoa"] },
    },
    { by: "nv06", text: "Dạ chắc có ảnh của em 😅" },
    { by: "lead1", text: "Có 1 ảnh của em đó 😄 sửa rồi nhé.", react: { "😂": ["nv06", "nv05"] } },
  ]),
  sc("2026-10-08", "13:15", [
    {
      by: "linh",
      text: "Thông tin từ phòng nhân sự: công ty đang tuyển **6 retoucher**, dự kiến từ 12/10 sẽ có 2–3 bạn mới vào thử việc. Chị nhờ @{lead1} @{lead2} mỗi nhóm cử 1 bạn kèm người mới trong 2 tuần đầu nhé.",
      edited: "Thông tin từ phòng nhân sự: công ty đang tuyển **6 retoucher**, dự kiến từ **19/10** sẽ có 2–3 bạn mới vào thử việc. Chị nhờ @{lead1} @{lead2} mỗi nhóm cử 1 bạn kèm người mới trong 2 tuần đầu nhé.",
      react: { "👍": ["lead1", "lead2", "boss"], "🎉": ["nv09", "nv01"] },
      thread: [
        { by: "lead1", text: "Nhóm A em đề xuất @{nv01} kèm ạ, bạn ấy làm HDR chắc tay nhất.", gap: 5 },
        { by: "nv01", text: "Dạ em nhận ạ, em soạn sẵn tài liệu HDR cơ bản" },
        { by: "lead2", text: "Nhóm B @{nv10} kèm ạ." },
        { by: "nv10", text: "Ok ạ, cho người mới ngồi gần mình nha 😄" },
        { by: "linh", text: "Cảm ơn hai em 👍" },
      ],
    },
    { by: "lead2", text: "Nhân tiện lịch ca tuần sau chị Linh chốt chưa ạ?" },
    { by: "linh", text: "Chiều thứ 7 chị chốt nha, em nào xin nghỉ tuần sau gửi chị trước thứ 6." },
  ]),
  sc("2026-10-08", "20:00", [
    { by: "nv15", text: "Màn hình máy em bị sọc ngang từ chiều, nhìn màu trời khó quá ạ 😢", files: [{ name: "man-hinh-soc-ngang.jpg", hint: "ảnh chụp màn hình máy tính có các vạch sọc ngang trên ảnh nhà đang chỉnh" }] },
    { by: "nv15", text: "Em gửi nhầm 2 lần ạ", deleted: true },
    { by: "lead2", text: "Em qua máy 20 làm tạm, màn hình đó đã cân màu rồi. Mai mình báo IT đổi màn." },
    { by: "nv15", text: "Dạ em đổi máy rồi ạ" },
    { by: "nv12", text: "Làm màu trời trên màn sọc là toang thật 😂", react: { "😂": ["nv15", "nv13"] } },
  ]),

  // ── Fri 9/10 ────────────────────────────────────────────────────────────────────────────────────
  sc("2026-10-09", "07:40", [
    {
      by: "lead1",
      text: "Đầu ca 9/10:\n- HDR Sydney: giao 4h40 ✅\n- Twilight 30 ảnh: 20/30\n- Đơn mới: HDR 120 ảnh agency Brisbane (deadline 6h sáng mai, Brisbane không đổi giờ)\n- Cut-out khách Nhật **batch 2: 80 ảnh** đã về, @{nv11} @{nv14} @{nv04} chiều nhận\n\n@{nv05} @{nv06} @{nv08} @{nv03} HDR Brisbane.",
      react: { "👍": ["nv03", "nv05", "nv06", "nv08"], "🔥": ["lead2"] },
      thread: [
        { by: "nv08", text: "Cut-out batch 2 em có làm không ạ?", gap: 4 },
        { by: "lead1", text: "Sáng mai em làm cùng @{nv04} nha, hôm nay HDR trước." },
        { by: "nv08", text: "Dạ ok ạ 👍" },
      ],
    },
    { by: "nv04", text: "Dạ cut-out em vào từ 13h luôn ạ" },
    { by: "nv07", text: "Twilight 10 ảnh còn lại em với @{nv02} xong trước 10h ạ" },
  ]),
  sc("2026-10-09", "10:30", [
    { by: "nv06", text: "Đơn Brisbane có mấy ảnh nắng chiếu vệt dài trên sàn gỗ, mình giữ hay giảm vậy ạ?" },
    { by: "acc1", text: "Khách thích giữ nắng cho ấm, chỉ giảm chỗ nào cháy trắng thôi nha." },
    { by: "khoa", text: "Giữ nắng nhưng đừng để ám vàng lan sang tường nhé, checklist dòng 3 đó 😄", react: { "😂": ["nv06"], "👍": ["nv05"] } },
  ]),
  sc("2026-10-09", "14:20", [
    {
      by: "acc1",
      text: "Khách Nhật vừa gửi mail: batch 1 **đạt hết sau khi sửa**, họ muốn bàn hợp đồng hàng tháng (ước 1.500–2.000 ảnh/tháng) nếu batch 2 giữ chất lượng. @{boss} anh xem mình nhận được khối lượng này với nhân sự hiện tại không ạ?",
      react: { "🎉": ["lead2", "khoa", "nv11", "nv14"], "😮": ["nv04"] },
    },
    {
      by: "boss",
      text: "Tin tốt quá 👏 Với 6 bạn mới đang tuyển thì nhận được. @{lead2} @{khoa} cho anh ý kiến: cut-out có đủ người làm và người kèm không?",
      gap: 25,
    },
    { by: "lead2", text: "Hiện có @{nv11} @{nv14} chắc tay, @{nv04} @{nv08} đang lên. Nếu 2.000 ảnh/tháng thì cần thêm 2 người chuyên cut-out ạ." },
    { by: "khoa", text: "QC cut-out tốn thời gian gấp đôi HDR sếp ạ. Em đề xuất đào tạo thêm 1 bạn QC phụ." },
    {
      by: "boss",
      text: "Ok, thứ 2 họp nhanh với chị Linh chốt nhé. @{acc1} trả lời khách là mình rất sẵn sàng, báo giá gửi sau.",
      react: { "👍": ["acc1", "lead2", "khoa"], "🔥": ["nv11"] },
      thread: [
        { by: "acc1", text: "Dạ em trả lời khách rồi ạ @{boss}, khách hẹn gọi video thứ 3.", gap: 30 },
        { by: "nv11", text: "Batch 2 tụi em làm kỹ hết sức ạ 💪", react: { "👏": ["lead2", "khoa"] } },
        { by: "nv14", text: "Em cũng vậy ạ, toàn bộ đi Pen hết 😄" },
      ],
    },
  ]),
  sc("2026-10-09", "17:30", [
    {
      by: "lead2",
      text: "@{boss} @{linh} cuối tuần này đơn Brisbane + cut-out batch 2 dồn lại, nhóm B xin tăng ca tối thứ 7 (10/10) đến 22h cho 4 bạn: @{nv09} @{nv11} @{nv13} @{nv14}. Anh chị duyệt giúp em nhé.",
      edited: "@{boss} @{linh} cuối tuần này đơn Brisbane + cut-out batch 2 dồn lại, nhóm B xin tăng ca tối thứ 7 (10/10) đến **23h** cho 4 bạn: @{nv09} @{nv11} @{nv13} @{nv14}. Anh chị duyệt giúp em nhé.",
      react: { "👀": ["nv09", "nv13"] },
    },
    { by: "linh", text: "Chị ok phía vận hành, chờ anh duyệt nha." },
    { by: "nv13", text: "Em đi được ạ" },
    { by: "nv09", text: "Em ok luôn" },
  ]),
  sc("2026-10-09", "21:30", [
    {
      by: "lead2",
      text: "Ca chiều 9/10:\n- HDR Brisbane: 96/120, @{nv10} @{nv15} làm nốt đến 22h30\n- Cut-out batch 2: 28/80\n- Twilight: giao xong ✅\n\nSáng mai @{lead1} xem giúp mấy ảnh HDR còn lại nếu ca chiều không kịp nhé.",
    },
    { by: "nv15", text: "Em còn 7 ảnh ạ, 22h15 xong" },
    { by: "nv10", text: "Mình còn 9, chắc xong cùng lúc 😄" },
    { by: "nv14", text: "Cut-out batch này khó hơn batch 1, nhiều ly có hoa văn khắc ạ 😵" },
    {
      by: "khoa",
      text: "Hoa văn khắc thì giữ nguyên texture, không làm mịn. Mai anh QC sớm lúc 7h30.",
      react: { "🙏": ["nv14", "nv11"] },
    },
  ]),

  // ── Sat 10/10 — today (now ≈ 18:40) ─────────────────────────────────────────────────────────────
  sc("2026-10-10", "07:50", [
    {
      by: "lead1",
      text: "Đầu ca thứ 7 10/10:\n- HDR Brisbane: giao 5h50 ✅ (ca chiều làm xong hết, cảm ơn @{nv10} @{nv15})\n- Cut-out khách Nhật batch 2: 28/80, deadline 8h sáng thứ 2 VN\n- Đơn mới: sky replacement 35 ảnh, object removal 20 ảnh\n\n@{nv04} @{nv08} cut-out sáng nay, @{nv02} sky, @{nv06} object removal.",
      react: { "👏": ["nv10", "nv15", "lead2"], "👍": ["nv02", "nv06"] },
      thread: [
        { by: "nv15", text: "Dạ hôm qua về hơi trễ mà vui ạ 😄", gap: 40 },
        { by: "nv10", text: "Xong sớm hơn dự kiến 15 phút đó trưởng ca 😎" },
      ],
    },
    { by: "nv08", text: "Dạ em làm cut-out ạ, chỗ nào khó em hỏi @{nv11} chiều nay" },
    { by: "nv02", text: "Sky 35 ảnh em nhận, trưa xong ạ" },
  ]),
  sc("2026-10-10", "10:30", [
    {
      by: "khoa",
      text: "QC sớm cut-out batch 2 (28 ảnh tối qua): 25 đạt, 3 ảnh hoa văn khắc bị mờ do chạy Smart Sharpen sau khi tách. @{nv14} @{nv11} chiều vào xem lại giúp anh nha.",
      react: { "👀": ["nv04", "nv08", "lead1"] },
    },
    { by: "nv04", text: "Sáng nay em làm 12 ảnh, em check lại theo note của anh ạ" },
    {
      by: "khoa",
      text: "12 ảnh của @{nv04} anh vừa xem, đạt hết 👍",
      gap: 35,
      react: { "❤️": ["nv04"], "👏": ["lead1", "nv08"] },
    },
  ]),
  sc("2026-10-10", "14:10", [
    {
      by: "acc2",
      text: "🚨 Đơn gấp khách Mỹ: agency ở New York cần **36 ảnh HDR + 8 ảnh twilight** cho buổi mở bán, hạn 8h sáng chủ nhật giờ New York = **19h tối mai** VN. Khách muốn xem trước **10 ảnh mẫu trong tối nay**. @{lead2} ca chiều xếp được không?",
      react: { "👀": ["lead2", "nv12", "nv13"] },
      thread: [
        { by: "nv09", text: "Twilight làm chủ nhật được không ạ, tối nay em ưu tiên cut-out?", gap: 6 },
        { by: "acc2", text: "Được, twilight hạn 19h tối mai VN." },
        { by: "lead2", text: "Ok vậy mai @{nv09} trực làm 8 ảnh twilight, mình xin chị Linh thêm 1 bạn nhóm A." },
      ],
    },
    { by: "lead2", text: "Được. @{nv12} @{nv13} HDR 36 ảnh, 10 ảnh mẫu xong trước 18h." },
    { by: "nv12", text: "Dạ em nhận ạ" },
    { by: "nv13", text: "Ok, em lấy 18 ảnh cuối nha @{nv12}" },
    {
      by: "acc2",
      text: "Before/after mẫu khách gửi đây, style sáng, tường trắng sạch:",
      files: [{ name: "khach-ny-before-after-mau.jpg", hint: "before/after HDR phòng khách sáng, tường trắng sạch, cửa sổ thấy cây xanh bên ngoài" }],
      react: { "👍": ["nv12", "nv13"] },
    },
  ]),
  sc("2026-10-10", "15:20", [
    {
      by: "linh",
      text: "## Lịch ca tuần 12–17/10\n- **Ca sáng (nhóm A)**: @{lead1} @{nv01} @{nv02} @{nv03} @{nv04} @{nv05} @{nv06} @{nv07} @{nv08}\n- **Ca chiều (nhóm B)**: @{lead2} @{nv09} @{nv10} @{nv11} @{nv12} @{nv13} @{nv14} @{nv15}\n- **Nghỉ phép**: @{nv07} thứ 4 14/10, @{nv12} thứ 6 16/10\n- **Ca trực chủ nhật 11/10** (đơn New York): @{nv09}, @{nv02}\n\nTừ 19/10 có bạn thử việc mới, tuần này @{nv01} @{nv10} chuẩn bị giúp chị máy và tài liệu nhé.",
      react: { "👍": ["lead1", "lead2", "nv01", "nv10", "nv12"], "✅": ["nv07", "nv09"] },
      thread: [
        { by: "nv02", text: "Dạ mai em trực được ạ, mấy giờ vào vậy chị?", gap: 8 },
        { by: "linh", text: "9h nha em, xong twilight với @{nv09} là về." },
        { by: "nv09", text: "Ok, mai mình chia mỗi người 4 ảnh nha @{nv02}" },
      ],
    },
  ]),
  sc("2026-10-10", "16:30", [
    {
      by: "lead1",
      text: "Bàn giao ca 10/10 cho @{lead2}:\n- Cut-out batch 2: 52/80 (sáng làm 24 ảnh)\n- Sky 35 ảnh: giao ✅\n- Object removal 20 ảnh: giao ✅\n- Đơn New York: chuyển ca chiều\n\n@{boss} báo cáo tuần 5–10/10 nhóm A: **1.380 ảnh**, trả về **1,2%** – lần đầu xuống dưới 1,5% từ khi áp dụng checklist QC v2 🎉",
      react: { "🎉": ["lead2", "khoa", "nv01", "nv05", "nv06"], "💯": ["linh"] },
      thread: [
        { by: "boss", text: "Tuyệt vời 👏 Checklist v2 hiệu quả rõ. @{khoa} tuần sau nhân rộng cho nhóm B nhé.", gap: 14 },
        { by: "khoa", text: "Dạ sếp, nhóm B tuần này 1,6%, tuần sau em kèm sát hơn." },
        { by: "lead2", text: "Nhóm B sẽ đuổi kịp nhóm A tuần sau 😤", react: { "😂": ["lead1", "nv10"] } },
        { by: "lead1", text: "Chờ xem nha 😄" },
      ],
    },
    { by: "lead2", text: "Nhận ca 👍 @{nv11} @{nv14} vào cut-out 28 ảnh còn lại nha, 3 ảnh hoa văn anh Khoa note thì sửa trước." },
  ]),
  sc("2026-10-10", "17:45", [
    {
      by: "lead2",
      text: "@{boss} anh duyệt giúp em tăng ca tối nay đến 23h cho @{nv09} @{nv11} @{nv13} @{nv14} với ạ. Cut-out batch 2 còn 28 ảnh + đơn New York 36 ảnh.",
    },
    { by: "linh", text: "Chị duyệt phía vận hành rồi, chờ anh nữa thôi nha." },
    { by: "nv11", text: "Batch 2 em với @{nv14} chia mỗi người 14 ảnh, 22h xong ạ" },
    { by: "nv14", text: "Ok bạn 👍 3 ảnh hoa văn mình sửa xong rồi nha @{khoa}" },
    {
      by: "nv12",
      text: "10 ảnh mẫu đơn New York xong rồi ạ @{acc2} @{lead2}",
      gap: 18,
    },
    {
      by: "nv13",
      text: "Em up 10 ảnh mẫu vào folder `_preview` rồi ạ",
      edited: "Em up 10 ảnh mẫu vào folder `_preview/NY-10-10` rồi ạ",
    },
    { by: "acc2", text: "Gửi khách rồi nè, cảm ơn @{nv12} @{nv13} 🙏", react: { "❤️": ["nv12", "nv13"] } },
    { by: "lead2", text: "@{lead1} mai chủ nhật @{nv02} trực với @{nv09} nhé, cảm ơn nhóm A cho mượn người 😄" },
  ]),
];
