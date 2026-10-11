/**
 * INVENTED chat content (LOCAL TEST SEED ONLY) for the office channels #marketing and #it-ho-tro.
 * Everything is fiction: no real clients, prices or staff names. People are persona keys only.
 */
import type { ChatScene, ConversationRef } from "../types.js";

const MK: ConversationRef = { channel: "marketing" };
const IT: ConversationRef = { channel: "it-ho-tro" };

export const scenesOffice: ChatScene[] = [
  // ════════════════════════════════════════ #marketing ════════════════════════════════════════
  {
    where: MK,
    date: "2026-08-25",
    time: "10:20",
    lines: [
      {
        by: "an",
        text: "Chào cả nhà marketing 👋 Từ hôm nay mình chuyển hết trao đổi fanpage, portfolio, website sang kênh này nhé. Nhóm Zalo cũ chỉ để đọc lại thôi.",
        react: { "👍": ["boss", "linh", "hanh", "minh"], "🎉": ["acc1"] }
      },
      { by: "hanh", gap: 3, text: "Dạ em vào rồi ạ. Giao diện dễ dùng hơn em tưởng 😆" },
      {
        by: "boss",
        gap: 9,
        text: "Ok. An tổng hợp kế hoạch nội dung tháng 9 gửi anh trước thứ 5 nhé. Anh muốn thấy rõ mỗi tuần đăng gì, để làm gì."
      },
      { by: "an", gap: 2, text: "Dạ anh, em với Hạnh làm xong gửi anh trong ngày mai ạ." },
      {
        by: "acc1",
        gap: 15,
        text: "Cho bên account xin thêm 1 mục **portfolio theo từng dịch vụ** nha, gửi khách mới hay bị hỏi lắm."
      },
      { by: "an", gap: 4, text: "Ok @{acc1}, mình đưa vào kế hoạch luôn." },
      {
        by: "minh",
        gap: 20,
        text: "Anh cũng theo dõi kênh này phần website nhé. Gallery, landing page có gì cứ tag anh.",
        react: { "👍": ["an", "hanh"] }
      }
    ]
  },
  {
    where: MK,
    date: "2026-08-26",
    time: "15:10",
    lines: [
      {
        by: "an",
        text: "Gửi @{boss} và @{linh} bản kế hoạch nội dung tháng 9 ạ. Tóm tắt:\n\n- 3 bài/tuần trên fanpage: 1 before/after, 1 tips/hậu trường, 1 reels\n- Chủ đề chính: HDR & thay trời, virtual staging, day-to-dusk\n- Cuối tháng có bài Trung thu\n- Mục tiêu: tăng tương tác và có thêm inbox từ agency nước ngoài",
        files: [
          {
            name: "ke-hoach-noi-dung-thang-9.xlsx",
            hint: "content calendar fanpage tháng 9: ngày đăng, chủ đề, định dạng, người phụ trách, trạng thái"
          }
        ],
        react: { "👍": ["hanh"], "👀": ["linh", "boss"] },
        thread: [
          {
            by: "boss",
            gap: 25,
            text: "Ổn. Reels virtual staging anh muốn ra sớm, tuần đầu tháng 9 luôn. Khách nước ngoài xem video nhiều hơn ảnh tĩnh."
          },
          { by: "an", gap: 3, text: "Dạ, em đẩy reels lên tuần 1, đổi chỗ với bài tips ạ." },
          {
            by: "linh",
            gap: 10,
            text: "Bài before/after nhớ chọn ảnh đã xin phép khách hoặc ảnh mẫu nội bộ nhé, đừng lấy ảnh đơn đang chạy."
          },
          {
            by: "hanh",
            gap: 2,
            text: "Dạ em ghi chú vào file rồi ạ: chỉ dùng ảnh trong thư mục **Portfolio đã duyệt**."
          },
          { by: "boss", gap: 5, text: "Duyệt. Làm đi.", react: { "🔥": ["an", "hanh"] } }
        ]
      },
      { by: "hanh", gap: 50, text: "Chị An ơi, em lên bản nháp bài before/after đầu tiên luôn nha chị?" },
      { by: "an", gap: 3, text: "Ừ em lên đi, sáng mai chị duyệt sớm." }
    ]
  },
  {
    where: MK,
    date: "2026-08-28",
    time: "09:40",
    lines: [
      {
        by: "hanh",
        text: "Em gửi bản nháp bài before/after HDR ạ. Caption:\n\n> Một phòng khách, 5 bracket, 1 bức ảnh hoàn chỉnh. Cửa sổ trong trẻo, nội thất đủ sáng, màu tường đúng thực tế.\n\nẢnh em lấy từ bộ mẫu nội bộ ạ.",
        files: [
          {
            name: "before-after-hdr-phong-khach.jpg",
            hint: "before/after HDR blending phòng khách, cửa sổ được kéo chi tiết bên ngoài"
          }
        ]
      },
      {
        by: "an",
        gap: 12,
        text: "Ảnh ok. Caption em rút gọn câu đầu, thêm 1 dòng tiếng Anh ở cuối vì phần lớn người xem là khách nước ngoài nhé."
      },
      { by: "hanh", gap: 4, text: "Dạ em sửa liền ạ." },
      {
        by: "hanh",
        gap: 15,
        text: "Em sửa xong ạ, dòng tiếng Anh: “5 brackets in. One clean image out.”",
        edited: "Em sửa xong ạ, dòng tiếng Anh: “Five brackets in. One clean, natural image out.”"
      },
      {
        by: "an",
        gap: 3,
        text: "Được rồi. @{boss} anh xem giúp em bài này, ok thì em lên lịch đăng 19h tối nay ạ."
      },
      {
        by: "boss",
        gap: 30,
        text: "Ảnh đẹp. Đăng đi. Lần sau thêm 1 ảnh zoom vùng cửa sổ, khách chuyên nghiệp nhìn chỗ đó đầu tiên.",
        react: { "🙏": ["an", "hanh"] }
      },
      { by: "hanh", gap: 2, text: "Dạ em ghi nhớ ạ!" },
      { by: "an", gap: 2, text: "Lên lịch 19h rồi nhé.", react: { "✅": ["hanh"] } }
    ]
  },
  {
    where: MK,
    date: "2026-08-31",
    time: "14:30",
    lines: [
      {
        by: "acc1",
        text: "Marketing ơi, có lead mới là agency BĐS ở Mỹ, họ hỏi mẫu virtual staging phòng trống → full nội thất. Mình có bộ nào gửi được không?",
        thread: [
          {
            by: "an",
            gap: 6,
            text: "Có 4 bộ, mình gom vào 1 link nhé: [Portfolio virtual staging](https://nesso.example/portfolio/virtual-staging)"
          },
          { by: "acc1", gap: 3, text: "Cảm ơn An. Có bản PDF gọn không, khách bên đó thích file đính kèm hơn link." },
          { by: "hanh", gap: 8, text: "Dạ để em xuất PDF 6 trang, chiều nay em gửi ạ." },
          {
            by: "hanh",
            gap: 120,
            text: "Em gửi ạ, bản tiếng Anh.",
            files: [
              {
                name: "portfolio-virtual-staging-EN.pdf",
                hint: "portfolio virtual staging 6 trang tiếng Anh, before/after phòng trống và phòng đã dàn dựng nội thất"
              }
            ],
            react: { "❤️": ["acc1"], "👍": ["an"] }
          }
        ]
      },
      { by: "acc2", gap: 40, text: "Cho em ké 1 bản nha, tuần này em cũng có 2 khách hỏi staging 😅" },
      { by: "an", gap: 5, text: "Lấy trong thread trên nhé @{acc2}.", react: { "👍": ["acc2"] } }
    ]
  },
  {
    where: MK,
    date: "2026-09-03",
    time: "10:15",
    lines: [
      {
        by: "an",
        text: "Reels virtual staging bản nháp 1 đây mọi người ơi. 22 giây, chuyển cảnh từ phòng trống sang có nội thất theo nhịp nhạc.",
        files: [
          {
            name: "reels-virtual-staging-nhap-1.png",
            hint: "thumbnail reels virtual staging, phòng trống chuyển sang phòng có sofa và thảm"
          }
        ],
        react: { "👀": ["linh", "hanh"] }
      },
      { by: "hanh", gap: 4, text: "Đẹp quá chị ơi 😍 đoạn sofa hiện ra mượt ghê" },
      {
        by: "boss",
        gap: 18,
        text: "Nhạc hơi buồn ngủ. Đổi nhạc nhanh hơn, 3 giây đầu phải có cú “wow” luôn, không thì người ta lướt qua."
      },
      {
        by: "an",
        gap: 3,
        text: "Dạ, em đưa cảnh before/after vào ngay giây đầu, đổi nhạc sôi động hơn ạ."
      },
      {
        by: "linh",
        gap: 7,
        text: "Thêm dòng chữ nhỏ “Virtual staging – 24h turnaround” được không An? Khách hay hỏi thời gian trả."
      },
      { by: "an", gap: 2, text: "Ok chị, em thêm ở cuối video." },
      {
        by: "boss",
        gap: 5,
        text: "Ừ, nhưng đừng ghi số giờ khi production chưa cam kết được với mọi đơn. Ghi “Fast turnaround” thôi.",
        react: { "👍": ["linh", "an"] }
      },
      { by: "an", gap: 3, text: "Dạ rõ ạ. Chiều mai em gửi bản 2." }
    ]
  },
  {
    where: MK,
    date: "2026-09-07",
    time: "11:00",
    lines: [
      {
        by: "minh",
        text: "Bên website bắt đầu dựng phần **Gallery** rồi nhé. Anh cần từ marketing:\n\n1. Mỗi dịch vụ 6–8 cặp before/after\n2. Ảnh xuất JPG cạnh dài 2400px, anh tự nén WebP\n3. Tên file dạng `dichvu_stt_before.jpg` / `dichvu_stt_after.jpg`\n\nDeadline mềm: cuối tuần sau.",
        react: { "👍": ["an", "hanh"] },
        thread: [
          {
            by: "an",
            gap: 15,
            text: "Ok anh. Dịch vụ chốt 6 nhóm: HDR, thay trời, day-to-dusk, virtual staging, xóa vật thể, cắt nền sản phẩm nhé?"
          },
          {
            by: "minh",
            gap: 5,
            text: "Ừ đúng 6 nhóm đó. Có slider kéo before/after nên 2 ảnh phải cùng khung, cùng kích thước."
          },
          {
            by: "hanh",
            gap: 10,
            text: "Dạ em lọc ảnh từ thư mục Portfolio rồi đổi tên theo quy tắc của anh Minh ạ.",
            react: { "👍": ["minh"] }
          }
        ]
      },
      {
        by: "boss",
        gap: 50,
        text: "Website mới phải có tiếng Anh và tiếng Nhật nhé Minh. Năm sau mình đẩy thị trường Nhật.",
        react: { "👀": ["minh", "an"] }
      },
      {
        by: "minh",
        gap: 4,
        text: "Dạ anh, em làm sẵn cấu trúc đa ngôn ngữ, nội dung JA mình thuê người dịch sau ạ."
      },
      { by: "an", gap: 6, text: "Landing page em thiết kế 2 phiên bản EN/JA cùng layout nhé anh Minh." }
    ]
  },
  {
    where: MK,
    date: "2026-09-09",
    time: "16:20",
    lines: [
      {
        by: "hanh",
        text: "Báo cáo nhanh reels virtual staging sau 4 ngày ạ:\n\n- Lượt xem: hơn 8 nghìn\n- Lượt chia sẻ: gấp 3 bài ảnh thường\n- 5 inbox hỏi dịch vụ, 2 inbox từ nước ngoài\n\nEm đã chuyển 2 inbox nước ngoài cho bên account ạ.",
        react: { "🔥": ["an", "boss", "linh"], "👏": ["acc1"] },
        thread: [
          {
            by: "boss",
            gap: 10,
            text: "Tốt. Đây là hướng đúng, tháng sau làm thêm reels day-to-dusk.",
            react: { "🙏": ["hanh"] }
          },
          { by: "acc1", gap: 6, text: "2 inbox đó em gửi portfolio rồi, 1 bên hẹn gửi đơn test tuần sau 🙌" },
          { by: "an", gap: 3, text: "Quá đã 😆" },
          {
            by: "linh",
            gap: 12,
            text: "Hạnh làm báo cáo gọn, dễ đọc. Giữ format này hàng tuần nhé em."
          },
          { by: "hanh", gap: 2, text: "Dạ em cảm ơn chị ạ 🥰" }
        ]
      }
    ]
  },
  {
    where: MK,
    date: "2026-09-11",
    time: "09:15",
    lines: [
      {
        by: "acc2",
        text: "Có khách Nhật mới hỏi dịch vụ cắt nền sản phẩm, họ yêu cầu viền rất sạch, giữ bóng đổ tự nhiên. Marketing có portfolio product cut-out chưa ạ?",
        thread: [
          {
            by: "an",
            gap: 8,
            text: "Chưa có bộ riêng em ơi, toàn ảnh BĐS. Để chị với Hạnh dựng nhanh 1 bộ từ ảnh mẫu sản phẩm nội bộ."
          },
          { by: "acc2", gap: 3, text: "Khách cần trong tuần sau thôi ạ, không gấp lắm." },
          {
            by: "linh",
            gap: 15,
            text: "Chị nhờ bên QC chọn giúp 10 ảnh cắt nền đạt chuẩn nhất tháng này, các em lấy làm mẫu nhé."
          },
          {
            by: "hanh",
            gap: 5,
            text: "Dạ em nhận ạ. Em làm bản PDF có zoom 200% phần viền, vì khách Nhật hay soi kỹ chỗ đó ạ."
          },
          { by: "acc2", gap: 2, text: "Hay quá, cảm ơn mọi người 🙏", react: { "❤️": ["hanh"] } }
        ]
      },
      {
        by: "boss",
        gap: 60,
        text: "Portfolio cho khách Nhật làm chỉn chu, có ghi chú tiếng Nhật đơn giản nếu được. Đây là thị trường anh muốn thắng.",
        react: { "👍": ["an", "acc2", "linh"] }
      },
      { by: "an", gap: 5, text: "Dạ anh. Em nhờ người dịch luôn mấy dòng chú thích ạ." }
    ]
  },
  {
    where: MK,
    date: "2026-09-15",
    time: "10:30",
    lines: [
      {
        by: "an",
        text: "Tuần này production đang chạy đơn mùa xuân của khách Úc rất căng, marketing mình tạm không xin ảnh mới từ sản xuất nhé. Lịch đăng giữ nguyên, dùng ảnh có sẵn.",
        react: { "👍": ["linh", "hanh"] },
        thread: [
          {
            by: "linh",
            gap: 8,
            text: "Đúng rồi. Sau đợt này chị chọn vài bộ đẹp, khách nào đồng ý cho dùng làm portfolio thì @{acc1} hỏi giúp nhé."
          },
          { by: "acc1", gap: 12, text: "Dạ chị, cuối tuần em gửi mail xin phép 3 khách dễ chịu nhất." }
        ]
      },
      {
        by: "hanh",
        gap: 40,
        text: "Chị An ơi, bài tips tuần này em viết về “Vì sao cửa sổ bị cháy sáng trong ảnh BĐS” được không ạ?"
      },
      {
        by: "an",
        gap: 4,
        text: "Được, nhưng ngắn thôi, 5 ý, có ảnh minh họa. Đừng viết như sách giáo khoa 😆"
      },
      { by: "hanh", gap: 2, text: "Dạ 😂" },
      {
        by: "boss",
        gap: 35,
        text: "Hay. Cuối bài gắn link portfolio HDR vào.",
        react: { "👍": ["hanh", "an"] }
      }
    ]
  },
  {
    where: MK,
    date: "2026-09-17",
    time: "14:00",
    lines: [
      {
        by: "an",
        text: "Về **quà Trung thu cho khách** (25/9), em đề xuất:\n\n- Khách nước ngoài: e-card động, lời chúc song ngữ + ảnh lồng đèn retouch\n- Đối tác trong nước: hộp bánh trung thu kèm thiệp in logo\n- Fanpage: 1 bài Trung thu hậu trường văn phòng\n\n@{boss} @{linh} anh chị góp ý giúp em ạ.",
        files: [
          { name: "banner-trung-thu-nhap.png", hint: "banner Trung thu tông vàng cam, lồng đèn, trăng tròn, logo công ty" }
        ],
        react: { "👀": ["boss", "linh"], "❤️": ["hanh", "acc2"] },
        thread: [
          { by: "boss", gap: 20, text: "Ý tưởng ok. E-card gửi đúng tên người liên hệ, đừng gửi kiểu mass mail." },
          {
            by: "linh",
            gap: 6,
            text: "Hộp bánh trong nước tầm chục đối tác thôi. Danh sách chị chốt với account, chi phí chị duyệt riêng."
          },
          { by: "acc1", gap: 10, text: "Em gửi danh sách khách nước ngoài cho e-card trước thứ 2 nha An." },
          { by: "an", gap: 3, text: "Ok, có danh sách là mình cá nhân hóa tên luôn." },
          {
            by: "acc2",
            gap: 5,
            text: "Khách Nhật mùa này cũng có lễ ngắm trăng, mình thêm 1 câu chúc tiếng Nhật được không ạ?"
          },
          { by: "boss", gap: 4, text: "Ý hay. Làm.", react: { "👍": ["an", "acc2"] } }
        ]
      },
      { by: "hanh", gap: 55, text: "Dạ em lên bản nháp bài fanpage Trung thu, mai gửi chị An ạ." }
    ]
  },
  {
    where: MK,
    date: "2026-09-18",
    time: "10:00",
    lines: [
      {
        by: "hanh",
        text: "Portfolio cắt nền sản phẩm cho khách Nhật xong rồi ạ, có zoom 200% phần viền và chú thích song ngữ Anh–Nhật.",
        files: [
          {
            name: "portfolio-cat-nen-san-pham-EN-JA.pdf",
            hint: "portfolio product cut-out nền trắng, zoom viền 200%, chú thích tiếng Anh và tiếng Nhật"
          }
        ],
        react: { "👏": ["an", "acc2", "linh"] }
      },
      { by: "acc2", gap: 10, text: "Cảm ơn Hạnh nhiều nha, để em gửi khách." },
      {
        by: "an",
        gap: 5,
        text: "Khoan @{acc2}. Trang 4 ảnh chai nước hoa viền hơi răng cưa, Hạnh thay ảnh khác rồi xuất lại nha."
      },
      { by: "hanh", gap: 3, text: "Dạ em thay liền ạ 😣" },
      {
        by: "hanh",
        gap: 25,
        text: "Em gửi lại bản đã thay ảnh ạ.",
        files: [{ name: "portfolio-cat-nen-san-pham-EN-JA-v2.pdf", hint: "portfolio product cut-out bản 2, trang 4 đã thay ảnh" }],
        react: { "👍": ["an", "acc2"] }
      },
      {
        by: "acc2",
        gap: 30,
        text: "Khách Nhật phản hồi rồi: họ muốn làm thử 20 ảnh vào đầu tháng 10 🎉",
        react: { "🎉": ["an", "hanh", "boss", "linh", "acc1"] }
      },
      {
        by: "boss",
        gap: 15,
        text: "Tốt. Đơn test này giao cho nhóm làm kỹ nhất, @{linh} sắp xếp nhé."
      },
      { by: "linh", gap: 5, text: "Dạ anh, chị bàn với QC luôn." }
    ]
  },
  {
    where: MK,
    date: "2026-09-21",
    time: "15:00",
    lines: [
      {
        by: "an",
        text: "E-card Trung thu bản hoàn chỉnh đây ạ, có 3 phiên bản EN / JA / VI.",
        files: [
          { name: "ecard-trung-thu-EN.png", hint: "e-card Trung thu tiếng Anh, lồng đèn đỏ, trăng tròn, nền xanh đêm" },
          { name: "ecard-trung-thu-JA.png", hint: "e-card Trung thu tiếng Nhật, lồng đèn, trăng tròn, cỏ lau" }
        ],
        react: { "❤️": ["hanh", "linh", "acc2"], "🔥": ["acc1"] }
      },
      {
        by: "boss",
        gap: 25,
        text: "Bản JA đẹp nhất 😄 Bản EN chữ hơi nhỏ khi xem trên điện thoại, tăng size lên."
      },
      { by: "an", gap: 3, text: "Dạ em sửa ạ." },
      { by: "hanh", gap: 2, text: "Chị An ơi file e-card EN em lỡ ghi đè mất rồi 😭", deleted: true },
      { by: "hanh", gap: 3, text: "À không sao ạ, em tìm thấy bản lưu trên NAS rồi 😅" },
      {
        by: "hanh",
        gap: 10,
        text: "Bài fanpage Trung thu em đặt lịch 8h sáng thứ 6 nhé chị An. Ảnh văn phòng chiều thứ 6 em chụp bổ sung đăng story."
      },
      {
        by: "linh",
        gap: 15,
        text: "Thứ 6 có tiệc 16h30, Hạnh chụp giúp vài tấm đẹp nhé. Nhớ hỏi mọi người trước khi đăng ảnh có mặt lên fanpage.",
        react: { "👍": ["hanh"] }
      },
      { by: "hanh", gap: 2, text: "Dạ chị, em sẽ hỏi từng người ạ." },
      { by: "acc1", gap: 30, text: "Danh sách e-card em gửi An qua tin nhắn riêng rồi nha, tổng 31 khách." },
      { by: "an", gap: 4, text: "Nhận rồi, cảm ơn nhé.", react: { "👍": ["acc1"] } }
    ]
  },
  {
    where: MK,
    date: "2026-09-23",
    time: "10:00",
    lines: [
      {
        by: "minh",
        text: "Landing page bản EN đã lên staging: [staging.nesso.example/en](https://staging.nesso.example/en)\nMọi người xem trên điện thoại giúp anh, góp ý ngay trong thread này nhé.",
        react: { "👀": ["an", "hanh", "acc1"] },
        thread: [
          {
            by: "acc1",
            gap: 12,
            text: "Form liên hệ thiếu ô chọn dịch vụ anh ơi, khách gửi về mình không biết họ hỏi gì.",
            edited: "Form liên hệ thiếu ô chọn dịch vụ anh ơi, khách gửi về bên account không biết họ cần dịch vụ nào."
          },
          { by: "minh", gap: 4, text: "Ok, anh thêm dropdown 6 dịch vụ." },
          { by: "an", gap: 8, text: "Slider before/after trên iPhone kéo hơi giật anh ạ." },
          { by: "minh", gap: 5, text: "Do ảnh chưa nén, chiều nay anh tối ưu lại." },
          { by: "hanh", gap: 3, text: "Footer chưa có link fanpage ạ 😅" },
          { by: "minh", gap: 2, text: "Chuẩn, cảm ơn em 👍", react: { "😂": ["hanh"] } }
        ]
      },
      { by: "boss", gap: 60, text: "Bản JA khi nào có Minh?" },
      {
        by: "minh",
        gap: 3,
        text: "Dạ người dịch hẹn đầu tháng 10 gửi, em dựng sẵn khung rồi ạ.",
        react: { "👍": ["boss"] }
      }
    ]
  },
  {
    where: MK,
    date: "2026-09-25",
    time: "08:15",
    lines: [
      {
        by: "hanh",
        text: "Bài Trung thu đã lên fanpage ạ 🥮 Chúc cả nhà Trung thu vui vẻ!",
        react: { "❤️": ["an", "linh", "boss", "acc2"], "🎉": ["acc1"] }
      },
      { by: "an", gap: 5, text: "E-card cũng gửi đủ 31 khách rồi nhé. Có 3 khách reply cảm ơn luôn 😄" },
      {
        by: "acc1",
        gap: 20,
        text: "Khách Úc lâu năm nhất reply: “lovely card, thanks team!” 😍",
        react: { "🔥": ["an", "hanh"] }
      },
      {
        by: "boss",
        gap: 10,
        text: "Tốt lắm team. Chiều nay ăn bánh nhé 😄",
        react: { "😂": ["hanh", "an"], "❤️": ["linh"] }
      },
      { by: "acc2", gap: 15, text: "Khách Nhật cũng trả lời bằng tiếng Nhật, họ khen thiệp đẹp 🙏" }
    ]
  },
  {
    where: MK,
    date: "2026-09-28",
    time: "10:30",
    lines: [
      {
        by: "hanh",
        text: "Em gửi báo cáo fanpage quý 3 ạ. Tóm tắt:\n\n- Người theo dõi tăng gần gấp đôi so với đầu quý\n- Reels chiếm khoảng 60% tổng lượt tiếp cận\n- 14 inbox có nhu cầu thật, account đã chuyển 4 thành đơn test\n- Bài tốt nhất: reels virtual staging và bài “cửa sổ cháy sáng”",
        files: [
          { name: "bao-cao-fanpage-Q3.xlsx", hint: "báo cáo fanpage quý 3: reach, tương tác, inbox theo tháng, top 5 bài" }
        ],
        react: { "👏": ["boss", "linh", "an"], "💯": ["acc1"] },
        thread: [
          {
            by: "boss",
            gap: 30,
            text: "Số liệu rõ ràng. Quý 4 anh muốn tỉ lệ inbox thành đơn test cao hơn, An với account ngồi lại bàn nhé."
          },
          { by: "an", gap: 5, text: "Dạ anh, tuần này em hẹn bên account ạ." },
          {
            by: "acc1",
            gap: 8,
            text: "Em đề xuất thêm nút “Gửi ảnh làm thử miễn phí” trên website, khách nước ngoài rất thích kiểu đó."
          },
          { by: "boss", gap: 6, text: "Được, nhưng giới hạn số ảnh làm thử. Linh chốt quy định." },
          { by: "linh", gap: 4, text: "Ok anh, chị chốt trong tuần.", react: { "👍": ["boss", "acc1"] } }
        ]
      },
      {
        by: "an",
        gap: 45,
        text: "Báo cáo này đủ làm bài tập cuối kỳ xịn luôn đó Hạnh 😆",
        react: { "😂": ["hanh", "acc1"] }
      }
    ]
  },
  {
    where: MK,
    date: "2026-09-29",
    time: "16:00",
    lines: [
      {
        by: "hanh",
        text: "Dạ mai là ngày cuối em thực tập rồi, mai chủ yếu bàn giao nên em xin phép cảm ơn mọi người trước ạ 🥺\n\nCảm ơn chị An đã kèm em từng caption, cảm ơn chị Linh, anh Minh, bên account và anh giám đốc đã cho em cơ hội. Em học được rất nhiều ạ!",
        react: { "❤️": ["an", "linh", "minh", "acc1", "acc2", "boss"], "😢": ["an", "acc2"] },
        thread: [
          { by: "an", gap: 5, text: "Huhu, em làm tốt lắm. Nhớ ghé chơi nha 🥹" },
          {
            by: "boss",
            gap: 12,
            text: "Cảm ơn Hạnh. Em chăm chỉ và tiến bộ nhanh. Sau này ra trường muốn quay lại thì nói anh.",
            react: { "❤️": ["hanh", "an"] }
          },
          { by: "hanh", gap: 3, text: "Dạ em cảm ơn anh nhiều ạ 🙏" },
          {
            by: "linh",
            gap: 6,
            text: "Chúc em bảo vệ tốt nhé. File bàn giao để vào thư mục Marketing/Ban-giao giúp chị."
          },
          { by: "minh", gap: 8, text: "Chúc em thi tốt 👍" },
          { by: "acc1", gap: 4, text: "Mất 1 người làm báo cáo đẹp rồi 😢 Chúc em mọi điều tốt nhất!" }
        ]
      },
      {
        by: "an",
        gap: 40,
        text: "Từ thứ 5 lịch đăng bài mình gom về An làm hết nhé, có việc gì gấp cứ tag mình.",
        react: { "👍": ["linh", "acc1"] }
      }
    ]
  },
  {
    where: MK,
    date: "2026-10-01",
    time: "10:00",
    lines: [
      {
        by: "minh",
        text: "Cập nhật website ạ:\n\n[x] Gallery 6 dịch vụ\n[x] Landing page EN\n[x] Form liên hệ có chọn dịch vụ\n[ ] Landing page JA (chờ bản dịch)\n[ ] Kiểm tra tốc độ trên mobile\n[ ] Trỏ tên miền\n\nĐề xuất ngày ra mắt: **15/10**.",
        react: { "👍": ["an", "linh"], "🔥": ["acc1"] }
      },
      {
        by: "boss",
        gap: 15,
        text: "Chốt 15/10. An làm chiến dịch đếm ngược trên fanpage từ 10/10 nhé.",
        thread: [
          { by: "an", gap: 3, text: "Dạ anh, em làm bộ banner D-5 → ngày ra mắt ạ." },
          {
            by: "linh",
            gap: 10,
            text: "Ngày ra mắt mình gửi email thông báo cho khách cũ luôn, @{acc1} chuẩn bị danh sách giúp chị."
          },
          { by: "acc1", gap: 5, text: "Dạ chị." }
        ]
      },
      { by: "minh", gap: 35, text: "Người dịch báo bản JA gửi khoảng thứ 6 tuần sau, tầm 9/10 ạ." },
      { by: "boss", gap: 6, text: "Ok, vẫn kịp. Không để trễ hơn.", react: { "👍": ["minh"] } }
    ]
  },
  {
    where: MK,
    date: "2026-10-05",
    time: "09:30",
    lines: [
      {
        by: "an",
        text: "Gửi kế hoạch nội dung Q4 ạ 📅\n\n## Tháng 10\n- Đếm ngược + ra mắt website (10–15/10)\n- 20/10: bài tôn vinh đồng nghiệp nữ\n- Reels day-to-dusk\n\n## Tháng 11–12\n- Series “1 ảnh – 5 bước” hậu trường retouch\n- Case study khách BĐS bên Úc (đã xin phép)\n- Bài cuối năm + thiệp Giáng sinh cho khách",
        files: [
          { name: "ke-hoach-noi-dung-Q4.xlsx", hint: "content calendar Q4 tháng 10–12: kênh, định dạng, chủ đề, KPI từng tháng" }
        ],
        react: { "👀": ["boss", "linh"], "👍": ["minh", "acc2"] },
        thread: [
          {
            by: "boss",
            gap: 35,
            text: "Thiếu nội dung cho khách Nhật. Thêm ít nhất 1 bài/tháng về cắt nền sản phẩm, chất lượng viền."
          },
          { by: "an", gap: 4, text: "Dạ, em thêm series “Clean edge” mỗi tháng 1 bài ạ." },
          {
            by: "acc2",
            gap: 10,
            text: "Đơn trial khách Nhật đang làm, nếu họ hài lòng em sẽ xin phép dùng 2–3 ảnh nha."
          },
          {
            by: "linh",
            gap: 7,
            text: "Chưa xin được thì dùng ảnh mẫu nội bộ. Tuyệt đối không dùng ảnh khách khi chưa có đồng ý bằng văn bản."
          },
          { by: "an", gap: 3, text: "Dạ rõ chị.", react: { "👍": ["linh"] } }
        ]
      },
      {
        by: "an",
        gap: 50,
        text: "Hạnh nghỉ rồi nên tháng 10 em xin thêm 1 bạn part-time dựng reels được không ạ @{boss}?"
      },
      {
        by: "boss",
        gap: 25,
        text: "Để anh xem ngân sách trong tuần. Trước mắt ưu tiên website, reels dời sang tháng 11 cũng được."
      },
      { by: "an", gap: 3, text: "Dạ ok anh." }
    ]
  },
  {
    where: MK,
    date: "2026-10-06",
    time: "14:00",
    lines: [
      {
        by: "acc1",
        text: "An ơi, lead mới bên Canada (agency BĐS) hỏi bộ day-to-dusk, gửi giúp mình bản PDF mới nhất với."
      },
      { by: "an", gap: 10, text: "Bản cũ thiếu 2 ảnh mới, đợi mình 30 phút cập nhật nha." },
      {
        by: "an",
        gap: 35,
        text: "Đây nhé, 8 cặp ảnh.",
        files: [{ name: "portfolio-day-to-dusk-EN.pdf", hint: "portfolio day-to-dusk tiếng Anh, 8 cặp ảnh nhà phố ngoại ô lúc hoàng hôn" }],
        react: { "🙏": ["acc1"] }
      },
      {
        by: "acc1",
        gap: 6,
        text: "Tuyệt, gửi khách rồi. Họ hỏi website có gallery không, mình bảo 15/10 có bản mới 😄"
      },
      { by: "minh", gap: 15, text: "Áp lực ghê 😅" },
      {
        by: "acc1",
        gap: 2,
        text: "Vậy là 15/10 phải lên đúng hẹn nha anh Minh 😂",
        react: { "😂": ["an", "minh"] }
      }
    ]
  },
  {
    where: MK,
    date: "2026-10-07",
    time: "10:45",
    lines: [
      {
        by: "an",
        text: "Bộ banner đếm ngược ra mắt website đây ạ, đăng từ 10/10 → 15/10:",
        files: [
          { name: "banner-countdown-D5.png", hint: "banner đếm ngược D-5 ra mắt website mới, slider before/after HDR" },
          { name: "banner-countdown-D1.png", hint: "banner đếm ngược D-1, tông xanh navy, chữ trắng" },
          { name: "banner-launch-15-10.png", hint: "banner ra mắt website 15/10, ảnh hero day-to-dusk nhà phố" }
        ],
        react: { "🔥": ["linh", "acc1", "acc2"], "👀": ["boss"] },
        thread: [
          { by: "boss", gap: 20, text: "Đẹp. Banner ngày ra mắt thêm mã QR dẫn về website." },
          { by: "an", gap: 3, text: "Dạ ok anh." },
          { by: "minh", gap: 6, text: "QR dùng link có tham số theo dõi nhé An, để anh đo được lượt vào từ fanpage." },
          { by: "minh", gap: 4, text: "[Link cho QR](https://nesso.example/?src=fanpage-launch)" },
          { by: "an", gap: 2, text: "Nhận ạ 👍" }
        ]
      },
      {
        by: "linh",
        gap: 40,
        text: "Ngày 15/10 có cần thông báo nội bộ không An? Chị nghĩ nên để cả công ty cùng chia sẻ bài."
      },
      {
        by: "an",
        gap: 5,
        text: "Có chị, em soạn sẵn tin cho kênh thông báo, chị đăng giúp em nhé.",
        react: { "👍": ["linh"] }
      }
    ]
  },
  {
    where: MK,
    date: "2026-10-08",
    time: "15:30",
    lines: [
      {
        by: "an",
        text: "Ý tưởng 20/10: bộ ảnh chân dung các chị em trong công ty, mỗi người 1 câu nói về nghề retouch, đăng album đúng ngày 20/10.",
        react: { "❤️": ["linh", "acc2"] },
        thread: [
          {
            by: "linh",
            gap: 12,
            text: "Dễ thương đó. Nhưng phải hỏi từng người đồng ý, ai không muốn lộ mặt thì chụp bàn tay cầm bút Wacom cũng được.",
            react: { "👍": ["an", "acc2"] }
          },
          {
            by: "boss",
            gap: 15,
            text: "Ok. Thêm phần quà nhỏ cho các chị em, việc đó Linh với hành chính lo. Marketing chỉ lo nội dung."
          },
          { by: "an", gap: 3, text: "Dạ anh." },
          { by: "acc2", gap: 8, text: "Em đăng ký làm mẫu nha 🙋‍♀️" },
          { by: "an", gap: 2, text: "Duyệt 😂", react: { "😂": ["acc2", "acc1"] } }
        ]
      },
      {
        by: "an",
        gap: 45,
        text: "Lịch chụp dự kiến thứ 2, 12/10, giờ nghỉ trưa, phòng họp nhỏ nhé.",
        edited: "Lịch chụp dự kiến thứ 3, 13/10, giờ nghỉ trưa, phòng họp nhỏ nhé."
      }
    ]
  },
  {
    where: MK,
    date: "2026-10-09",
    time: "10:00",
    lines: [
      {
        by: "minh",
        text: "Bản dịch JA về rồi mọi người ơi 🎉 Anh đã đưa lên staging: [Landing JA](https://staging.nesso.example/ja)",
        react: { "🎉": ["an", "acc2", "linh"] },
        thread: [
          {
            by: "acc2",
            gap: 20,
            text: "Em nhờ người quen biết tiếng Nhật đọc thử, họ bảo câu tiêu đề hơi cứng. Em gửi anh câu đề xuất qua tin riêng nha."
          },
          { by: "minh", gap: 5, text: "Ok em, chiều anh sửa." },
          {
            by: "an",
            gap: 15,
            text: "Trên Android nút CTA tiếng Nhật bị rớt dòng anh ạ.",
            edited: "Trên Android nút CTA tiếng Nhật bị rớt dòng và lệch icon anh ạ.",
            files: [{ name: "loi-nut-CTA-JA-android.png", hint: "screenshot nút CTA tiếng Nhật bị xuống dòng trên điện thoại Android" }]
          },
          { by: "minh", gap: 6, text: "Thấy rồi, do thiếu font dự phòng. Sửa trong hôm nay." }
        ]
      },
      {
        by: "minh",
        gap: 60,
        text: "Checklist trước ngày ra mắt còn lại:\n\n[x] Landing page JA\n[ ] Sửa tiêu đề JA + nút CTA trên Android\n[ ] Test form liên hệ gửi về account\n[ ] Trỏ tên miền (tối 14/10)\n\n@{boss} thứ 2 anh dành giúp em 30 phút xem bản cuối được không ạ?",
        react: { "👀": ["linh", "an"] }
      },
      { by: "linh", gap: 10, text: "Sáng thứ 2 anh có họp, chị đề xuất 14h nhé @{boss}." },
      { by: "an", gap: 5, text: "Em cũng cần anh duyệt banner ra mắt có mã QR trong buổi đó luôn ạ." }
    ]
  },
  {
    where: MK,
    date: "2026-10-09",
    time: "16:30",
    lines: [
      {
        by: "acc2",
        text: "Có khách mới bên Úc hỏi virtual staging cho căn hộ cao cấp. Mình có ảnh before/after căn hộ nào đẹp không An? Em gửi kèm mail ạ."
      },
      {
        by: "an",
        gap: 8,
        text: "Có bộ này mới làm mẫu tuần trước nè:",
        files: [
          { name: "before-after-staging-can-ho-1.jpg", hint: "before/after virtual staging căn hộ cao cấp, phòng khách view thành phố" },
          { name: "before-after-staging-can-ho-2.jpg", hint: "before/after virtual staging phòng ngủ master, phong cách tối giản" }
        ],
        react: { "❤️": ["acc2", "acc1"], "🔥": ["linh"] }
      },
      { by: "acc2", gap: 4, text: "Quá xịn, em gửi luôn đây ạ 🙏" },
      { by: "acc1", gap: 10, text: "Bộ này đưa vào gallery website luôn đi anh Minh, đẹp hơn mấy ảnh căn hộ hiện tại." },
      { by: "minh", gap: 6, text: "Ok, An gửi bản 2400px vào thư mục Website/Gallery nhé." },
      { by: "an", gap: 2, text: "Ok anh, sáng mai em đẩy lên.", react: { "👍": ["minh"] } }
    ]
  },
  {
    where: MK,
    date: "2026-10-10",
    time: "08:50",
    lines: [
      {
        by: "an",
        text: "Banner D-5 đã lên fanpage rồi nha mọi người, vào thả tim chia sẻ giúp em 🙏 [Xem bài](https://example.com/fanpage/post-d5)",
        react: { "👍": ["linh", "acc1", "acc2", "minh"], "❤️": ["boss"] }
      },
      { by: "acc1", gap: 15, text: "Share rồi 💪" },
      { by: "boss", gap: 25, text: "Đẹp. Mỗi ngày 1 banner, giữ giờ đăng cố định 8h nhé." },
      { by: "an", gap: 3, text: "Dạ anh, em đặt lịch sẵn đến 15/10 rồi ạ.", react: { "👍": ["boss"] } },
      { by: "an", gap: 30, text: "Ảnh căn hộ cho gallery em để vào thư mục rồi nha anh Minh." },
      { by: "minh", gap: 40, text: "Nhận, lên staging rồi nhé 👍", react: { "🙏": ["an"] } }
    ]
  },
  {
    where: MK,
    date: "2026-10-10",
    time: "14:30",
    lines: [
      {
        by: "minh",
        text: "@{boss} em đã hoàn thiện bản cuối website, anh duyệt giúp em để kịp ra mắt 15/10 ạ:\n\n- Link: [staging.nesso.example](https://staging.nesso.example)\n- Đã sửa tiêu đề JA + nút CTA trên Android\n- Form liên hệ test 5 lần đều về hộp thư account\n- Gallery thêm bộ căn hộ mới\n\nNếu anh duyệt trong cuối tuần thì tối 14/10 em trỏ tên miền, không cần chờ buổi thứ 2 ạ.",
        react: { "👀": ["linh", "an"], "🔥": ["acc1"] },
        thread: [
          { by: "linh", gap: 12, text: "Chị xem trên điện thoại rồi, ổn. Chờ anh duyệt nữa thôi @{boss}." },
          { by: "an", gap: 8, text: "Em check lại banner + QR trỏ đúng link rồi nha anh Minh ✅" },
          {
            by: "acc1",
            gap: 20,
            text: "Form em nhận đủ 5 mail test, tiêu đề mail có ghi dịch vụ khách chọn, rất tiện 👍"
          },
          { by: "minh", gap: 5, text: "Cảm ơn mọi người, giờ chờ sếp thôi 😄", react: { "😂": ["an"] } }
        ]
      }
    ]
  },
  {
    where: MK,
    date: "2026-10-10",
    time: "16:45",
    lines: [
      {
        by: "an",
        text: "Bản nháp banner 20/10 đây, @{linh} chị xem tông màu ổn chưa ạ? Em định đăng 8h sáng 20/10.",
        files: [{ name: "banner-20-10-nhap.png", hint: "banner 20/10 tông hồng pastel, hoa, lời chúc phụ nữ Việt Nam" }]
      },
      { by: "an", gap: 3, text: "Ảnh chân dung thì sau buổi chụp thứ 3 em ghép vào sau nha." }
    ]
  },

  // ════════════════════════════════════════ #it-ho-tro ════════════════════════════════════════
  {
    where: IT,
    date: "2026-08-25",
    time: "08:50",
    lines: [
      {
        by: "minh",
        text: "Chào mọi người, đây là kênh **hỗ trợ IT** trên Nesso Work 🛠️ Khi cần hỗ trợ, mọi người nhắn theo mẫu giúp anh:\n\n- Máy số mấy / vị trí ngồi\n- Lỗi gì, xảy ra từ lúc nào\n- Ảnh chụp màn hình lỗi (nếu có)\n- Mức độ: có đang chặn việc giao hàng cho khách không\n\nViệc gấp ảnh hưởng deadline khách thì tag thẳng anh.",
        react: { "👍": ["boss", "linh", "lead1", "lead2", "nv01"], "✅": ["khoa"] }
      },
      {
        by: "admin",
        gap: 6,
        text: "Bổ sung: vấn đề về **tài khoản Nesso Work** (quên mật khẩu, không thấy kênh, phân quyền dự án) thì tag mình @{admin} nhé.",
        react: { "👍": ["minh", "acc1"] }
      },
      {
        by: "boss",
        gap: 15,
        text: "Tốt. Mọi người hỏi ở đây, đừng nhắn riêng lẻ tẻ để sau còn tra lại được.",
        react: { "👍": ["minh", "admin"] }
      },
      { by: "nv06", gap: 10, text: "Dạ rõ ạ 👍" }
    ]
  },
  {
    where: IT,
    date: "2026-08-25",
    time: "14:10",
    lines: [
      {
        by: "nv03",
        text: "Em quên mật khẩu Nesso Work rồi ạ 😭 Máy văn phòng bắt đăng nhập lại mà em không nhớ, em đang nhắn bằng app điện thoại.",
        thread: [
          { by: "admin", gap: 7, text: "Em bấm “Quên mật khẩu” chưa? Hay để mình reset luôn cho nhanh." },
          { by: "nv03", gap: 2, text: "Dạ em bấm rồi mà chưa thấy gì ạ." },
          {
            by: "admin",
            gap: 4,
            text: "Ok, mình reset rồi, mật khẩu tạm gửi em qua tin nhắn riêng. Đăng nhập xong nhớ đổi ngay nhé."
          },
          { by: "nv03", gap: 5, text: "Dạ vào được rồi ạ, em cảm ơn 🙏", react: { "👍": ["admin"] } }
        ]
      },
      {
        by: "admin",
        gap: 30,
        text: "Nhắc chung: mật khẩu mới nên dài từ 10 ký tự, đừng dán giấy note lên màn hình nha mọi người 😅",
        edited: "Nhắc chung: mật khẩu mới nên dài từ 10 ký tự trở lên, không dùng lại mật khẩu cũ, và đừng dán giấy note lên màn hình nha mọi người 😅",
        react: { "😂": ["nv05", "nv08", "lead1"], "👍": ["minh"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-08-26",
    time: "10:30",
    lines: [
      { by: "nv07", text: "Em không thấy kênh san-xuat ở đâu ạ, chỉ có chung với thong-bao." },
      { by: "nv11", gap: 2, text: "Em cũng vậy ạ." },
      {
        by: "admin",
        gap: 6,
        text: "Kênh san-xuat là kênh công khai, 2 bạn bấm dấu **+** cạnh mục Kênh → Duyệt kênh → Tham gia nhé."
      },
      { by: "nv07", gap: 4, text: "A thấy rồi ạ, em vào được rồi.", react: { "👍": ["admin"] } },
      {
        by: "acc2",
        gap: 20,
        text: "Mình cài app trên điện thoại mà không có thông báo khi được tag, có cần bật gì không ạ?",
        thread: [
          {
            by: "minh",
            gap: 8,
            text: "Vào Cài đặt điện thoại → Thông báo → cho phép Nesso Work. Trong app thì vào Hồ sơ → Thông báo, chọn “Khi được nhắc đến”."
          },
          { by: "acc2", gap: 5, text: "Được rồi ạ, cảm ơn anh Minh.", react: { "👍": ["minh"] } }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-08-27",
    time: "15:20",
    lines: [
      {
        by: "lead2",
        text: "Máy in tầng 3 lại kẹt giấy, đèn đỏ nhấp nháy. Ai biết mở chỗ nào không?",
        files: [{ name: "may-in-tang-3-den-do.jpg", hint: "ảnh chụp máy in văn phòng đèn báo lỗi đỏ, khay giấy mở" }]
      },
      {
        by: "minh",
        gap: 10,
        text: "Mở nắp hông bên phải, kéo nhẹ tờ giấy theo chiều ra, đừng giật nha. Anh lên liền."
      },
      {
        by: "minh",
        gap: 15,
        text: "Xong rồi, do giấy bị ẩm. Mọi người cất giấy trong tủ, đừng để cạnh cửa sổ nhé.",
        react: { "👍": ["lead2", "nv12"], "🙏": ["nv02"] }
      },
      { by: "lead2", gap: 2, text: "Cảm ơn anh Minh 🙏" }
    ]
  },
  {
    where: IT,
    date: "2026-08-28",
    time: "20:40",
    lines: [
      {
        by: "nv09",
        text: "Anh Minh ơi Photoshop của em cứ mở file PSB của khách Úc là văng ra, file tầm 4GB ạ. Em thử 3 lần rồi.",
        files: [{ name: "loi-photoshop-psb.png", hint: "screenshot hộp thoại lỗi Photoshop 'Program Error' khi mở file PSB lớn" }],
        react: { "👀": ["lead2"] },
        thread: [
          {
            by: "lead2",
            gap: 5,
            text: "Em copy file về ổ D local rồi mở thử xem, mở thẳng trên NAS file to hay bị vậy."
          },
          { by: "nv09", gap: 12, text: "Copy về local thì mở được rồi ạ, nhưng lưu rất lâu." },
          { by: "lead2", gap: 3, text: "Tạm làm vậy nhé, mai nhờ anh Minh xem máy." },
          {
            by: "minh",
            gap: 680,
            text: "Sáng nay anh xem máy em rồi: RAM cấp cho Photoshop đang để 50%, anh tăng lên 75% và chuyển scratch disk sang ổ SSD. Em thử lại file đó giúp anh."
          },
          { by: "nv09", gap: 90, text: "Dạ mở và lưu ngon rồi ạ, nhanh hơn hẳn 🙏", react: { "👍": ["minh"] } }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-08-31",
    time: "09:15",
    lines: [
      {
        by: "an",
        text: "Anh Minh ơi cài giúp em bộ font thiết kế banner với ạ, em để trong thư mục Marketing/Fonts. Máy em không có quyền admin để cài."
      },
      {
        by: "minh",
        gap: 20,
        text: "Font này có giấy phép dùng thương mại chưa An? Dùng cho fanpage công ty thì phải có license nhé."
      },
      {
        by: "an",
        gap: 5,
        text: "Dạ 2 font miễn phí thương mại, 1 font em mua bằng tài khoản công ty rồi ạ, có hóa đơn."
      },
      {
        by: "minh",
        gap: 3,
        text: "Ok vậy chiều anh cài từ xa cho. Ai cần font gì cũng gửi qua đây, đừng tự tải font lạ trên mạng về nha.",
        react: { "👍": ["an", "admin"] }
      },
      { by: "minh", gap: 240, text: "Cài xong rồi An, em khởi động lại Illustrator là thấy." },
      { by: "an", gap: 10, text: "Thấy rồi ạ, cảm ơn anh 🙏" }
    ]
  },
  {
    where: IT,
    date: "2026-09-01",
    time: "09:00",
    lines: [
      {
        by: "acc1",
        text: "Em đang ở nhà theo dõi đơn khách Úc dịp lễ, VPN cứ kết nối được 5–10 phút là rớt ạ 😥",
        files: [{ name: "vpn-mat-ket-noi.png", hint: "screenshot ứng dụng VPN báo 'Connection lost, reconnecting...'" }],
        thread: [
          {
            by: "minh",
            gap: 25,
            text: "Em đang dùng wifi nhà hay 4G? Thử tắt chế độ tiết kiệm pin của laptop xem."
          },
          { by: "acc1", gap: 6, text: "Wifi nhà ạ. Tắt tiết kiệm pin rồi mà vẫn rớt." },
          {
            by: "minh",
            gap: 8,
            text: "Em đổi giao thức trong app VPN từ UDP sang TCP giúp anh: `Settings → Protocol → TCP`."
          },
          { by: "acc1", gap: 20, text: "Đổi xong 20 phút rồi chưa rớt lần nào ạ 👍" },
          {
            by: "minh",
            gap: 3,
            text: "Ok, nếu còn rớt thì chụp màn hình phần log gửi anh nhé. Lễ vui vẻ 😄",
            react: { "🙏": ["acc1"] }
          }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-04",
    time: "14:00",
    lines: [
      {
        by: "nv12",
        text: "Bút Wacom của em bị lag, vẽ mask nét cứ đứt quãng ạ, lực nhấn cũng không ăn.",
        react: { "👀": ["nv04"] },
        thread: [
          { by: "minh", gap: 10, text: "Em mở Wacom Tablet Properties xem driver bản nào, chụp giúp anh." },
          {
            by: "nv12",
            gap: 4,
            files: [{ name: "wacom-driver-version.png", hint: "screenshot Wacom Tablet Properties, mục About hiển thị phiên bản driver cũ" }]
          },
          { by: "minh", gap: 6, text: "Bản cũ rồi. 15h anh cập nhật từ xa cho em, em lưu file trước nhé." },
          { by: "nv12", gap: 70, text: "Cập nhật xong bút mượt lại rồi anh ơi 😍", react: { "👍": ["minh"] } }
        ]
      },
      { by: "nv04", gap: 100, text: "Anh Minh ơi máy em cũng bị y vậy, tiện cập nhật giúp em luôn ạ 🙏" },
      {
        by: "minh",
        gap: 5,
        text: "Ok, tối nay sau ca chiều anh cập nhật driver Wacom cho cả tầng 2, mai mọi người không cần làm gì.",
        react: { "🙏": ["nv04", "nv12", "lead1"], "👏": ["nv07"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-07",
    time: "09:30",
    lines: [
      {
        by: "acc1",
        text: "Khách gửi ảnh chụp tham khảo bằng iPhone, đuôi .HEIC, Photoshop máy em không mở được. Có cách nào nhanh không ạ?",
        thread: [
          {
            by: "minh",
            gap: 12,
            text: "Có 2 cách:\n\n1. Trên Windows cài HEIF Image Extensions (anh cài cho máy em rồi), mở bằng Photos rồi lưu ra JPG\n2. Nhiều file thì bỏ vào thư mục `Convert-HEIC` trên NAS, script tự chuyển sang JPG sau 1–2 phút"
          },
          { by: "acc1", gap: 6, text: "Cách 2 tiện quá, cảm ơn anh!" },
          { by: "lead2", gap: 15, text: "Cho trưởng ca quyền vào thư mục đó luôn được không anh Minh?" },
          { by: "minh", gap: 4, text: "Được, anh thêm group Truong-ca vào rồi.", react: { "👍": ["lead2"] } }
        ]
      },
      {
        by: "linh",
        gap: 50,
        text: "Upload ảnh HEIC vào task trên Nesso Work thì không thấy ảnh xem trước, chỉ hiện tên file. Có bình thường không Minh?"
      },
      {
        by: "minh",
        gap: 6,
        text: "Dạ hiện app chưa hiển thị preview HEIC chị ạ, file vẫn tải về được. Em ghi nhận để cải thiện, trước mắt mọi người chuyển sang JPG rồi upload giúp em.",
        react: { "👍": ["linh", "acc1"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-08",
    time: "11:00",
    lines: [
      {
        by: "lead1",
        text: "Khách Úc muốn nhận lại cả file PSD còn layer, tổng 12GB. Gửi kiểu gì cho nhanh vậy anh Minh?",
        thread: [
          {
            by: "minh",
            gap: 8,
            text: "Đừng gửi qua mail hay mấy trang gửi file miễn phí nhé. Dùng **chia sẻ ngoài của NAS**:\n\n1. Chuột phải thư mục → Share link\n2. Đặt hạn 7 ngày + mật khẩu\n3. Gửi link cho account, mật khẩu gửi riêng qua kênh khác"
          },
          { by: "lead1", gap: 5, text: "Mình không có quyền tạo link share." },
          { by: "minh", gap: 3, text: "Anh mở quyền cho 2 trưởng ca và account rồi, thử lại nhé." },
          { by: "lead1", gap: 10, text: "Ok tạo được rồi. Cảm ơn nhé 👍", react: { "👍": ["minh"] } }
        ]
      },
      {
        by: "acc1",
        gap: 30,
        text: "Khách bên đó báo tải về nhanh, 15 phút là xong 12GB 😄",
        react: { "🔥": ["minh", "lead1"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-10",
    time: "15:00",
    lines: [
      {
        by: "loc",
        text: "Anh Minh ơi thứ 7 là ngày cuối của em. Em cần backup thư mục cá nhân, còn mấy action Photoshop em tự viết muốn để lại cho ca A dùng thì để ở đâu ạ?"
      },
      {
        by: "minh",
        gap: 10,
        text: "Action em để vào `\\\\nas01\\SanXuat\\Actions\\Ca-A`, file cá nhân thì anh backup ra ổ riêng cho em trước 16h thứ 6."
      },
      { by: "loc", gap: 5, text: "Dạ ok anh, mai em dọn máy xong báo anh.", react: { "👍": ["minh"] } },
      {
        by: "admin",
        gap: 20,
        text: "Tài khoản Nesso Work của Lộc mình sẽ khóa cuối ngày 12/9 nhé, lịch sử chat và task vẫn giữ lại."
      },
      {
        by: "lead1",
        gap: 8,
        text: "Bộ action của Lộc xịn lắm, cả ca A dùng hằng ngày 😢",
        react: { "😢": ["loc", "nv02", "nv05"], "❤️": ["loc"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-11",
    time: "10:00",
    lines: [
      {
        by: "nv14",
        text: "Màn hình của em bị ám vàng, so với máy bên cạnh khác hẳn, em sợ chỉnh màu trời bị sai ạ.",
        files: [{ name: "man-hinh-am-vang.jpg", hint: "ảnh chụp 2 màn hình cạnh nhau cùng mở 1 ảnh bầu trời, màn trái ám vàng" }],
        thread: [
          { by: "minh", gap: 15, text: "Màn đó cũng 5 năm rồi. Anh calibrate lại thử, vẫn lệch thì đổi màn." },
          {
            by: "khoa",
            gap: 10,
            text: "Màn của retoucher làm sky/HDR phải chuẩn màu nhé Minh. Tuần sau đơn Úc nhiều, QC không muốn bị khách trả ảnh vì màn hình."
          },
          {
            by: "minh",
            gap: 45,
            text: "Calibrate xong vẫn lệch nhiều, anh đổi màn dự phòng cho em rồi nhé @{nv14}."
          },
          { by: "nv14", gap: 5, text: "Dạ màn mới đẹp quá anh ơi, cảm ơn anh 🙏", react: { "👍": ["khoa", "minh"] } }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-14",
    time: "21:30",
    lines: [
      { by: "nv02", text: "Máy số 12 chạy cực chậm, mở 5 bracket HDR mà mất gần 2 phút ạ 😩" },
      {
        by: "nv06",
        gap: 3,
        text: "Máy em báo “Scratch disks are full” luôn rồi ạ.",
        files: [{ name: "scratch-disk-full.png", hint: "screenshot lỗi Photoshop 'Could not complete your request because the scratch disks are full'" }],
        react: { "😮": ["nv02"] }
      },
      {
        by: "lead2",
        gap: 5,
        text: "Mấy em vào ổ D xóa thư mục Temp cũ, trong Photoshop chọn Edit → Purge → All rồi thử lại. Đơn này 23h phải giao, đừng tắt máy giữa chừng."
      },
      { by: "nv06", gap: 8, text: "Xóa xong trống được 40GB, chạy lại bình thường rồi ạ.", react: { "👍": ["lead2"] } },
      { by: "nv02", gap: 6, text: "Máy em vẫn chậm ạ 😢" },
      {
        by: "lead2",
        gap: 4,
        text: "Em chuyển sang máy 15 đang trống bên cạnh làm tiếp. @{minh} sáng mai check máy 12 giúp nhé."
      },
      {
        by: "minh",
        gap: 640,
        text: "Sáng nay anh check máy 12: ổ SSD đầy 98% do cache Bridge, anh dọn rồi. Máy chạy lại bình thường nhé.",
        react: { "🙏": ["nv02", "lead2"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-16",
    time: "23:10",
    lines: [
      {
        by: "nv10",
        text: "NAS tối nay chậm quá, mở file PSB 3GB trong thư mục khách mất 4–5 phút ạ.",
        thread: [
          {
            by: "lead1",
            gap: 6,
            text: "Ca đêm đang 9 người cùng mở file nặng. Mấy em copy về local làm rồi đẩy lên lại nhé."
          },
          { by: "nv10", gap: 3, text: "Dạ ok ạ." },
          {
            by: "minh",
            gap: 520,
            text: "Đúng là NAS cũ đang quá tải. Cuối tuần này mình chuyển sang NAS mới nhanh hơn nhiều, chiều nay anh thông báo lịch cụ thể.",
            react: { "🔥": ["nv10", "lead1"] }
          }
        ]
      },
      { by: "nv01", gap: 15, text: "Em copy về local mở 20 giây là xong, ok rồi ạ 👍" }
    ]
  },
  {
    where: IT,
    date: "2026-09-17",
    time: "16:30",
    lines: [
      {
        by: "minh",
        text: "## Lịch chuyển NAS cũ → NAS mới\n- **Thứ 7 19/9, 12:00**: NAS cũ chuyển sang chỉ đọc\n- **Từ 12:00 thứ 7 → tối CN 20/9**: copy dữ liệu, cấu hình quyền\n- **Sáng thứ 2 21/9**: mọi người dùng NAS mới, ổ mạng giữ nguyên ký tự `S:` `Q:` `K:`\n\nTrong thời gian chuyển, ca chiều thứ 7 và ca trực CN làm trên ổ local, cuối ca anh gom lên giúp.\n\n@{boss} @{linh} anh chị duyệt lịch giúp em ạ.",
        react: { "👀": ["lead1", "lead2", "khoa"], "👍": ["admin"] },
        thread: [
          {
            by: "linh",
            gap: 15,
            text: "Chủ nhật có ca trực 4 bạn làm đơn Úc, phải giao trước 10h sáng thứ 2 giờ VN. Làm local vậy có kịp không Minh?"
          },
          {
            by: "minh",
            gap: 5,
            text: "Kịp chị, em chép sẵn file đơn đó xuống từng máy từ trưa thứ 7, giao xong em mới đồng bộ."
          },
          {
            by: "boss",
            gap: 20,
            text: "Duyệt. Backup đầy đủ trước khi chuyển, có sự cố gì gọi anh.",
            react: { "🙏": ["minh"] }
          },
          {
            by: "khoa",
            gap: 10,
            text: "Thư mục QC có lịch sử checklist các tháng, nhớ giữ quyền chỉ đọc cho retoucher nhé."
          },
          { by: "minh", gap: 3, text: "Dạ anh, em ghi chú rồi." }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-18",
    time: "15:30",
    lines: [
      {
        by: "minh",
        text: "Nhắc lại: **trước 11h30 mai (thứ 7)** mọi người lưu hết file đang làm lên NAS nhé. File để trên Desktop thì sau thứ 2 anh không chịu trách nhiệm đâu 😅",
        react: { "😂": ["nv05", "nv08"], "👍": ["lead1", "lead2"] }
      },
      { by: "nv08", gap: 10, text: "Anh ơi file đang làm dở chưa xong thì cũng lưu lên NAS luôn hả anh?" },
      { by: "minh", gap: 3, text: "Đúng rồi, lưu vào thư mục WIP của đơn đó." },
      {
        by: "lead1",
        gap: 15,
        text: "Ca A thứ 7 làm tới 12h là nghỉ. Ca chiều thì theo hướng dẫn làm local nhé."
      },
      { by: "nv05", gap: 5, text: "Ổ K: là ổ gì vậy anh? Em chưa thấy bao giờ." },
      {
        by: "minh",
        gap: 4,
        text: "Ổ K: là thư mục khách hàng của account, retoucher không cần đâu em 😄",
        react: { "😂": ["nv05"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-19",
    time: "12:00",
    lines: [
      {
        by: "minh",
        text: "Bắt đầu chuyển NAS. Từ giờ NAS cũ **chỉ đọc**, mọi người không lưu lên được nữa nhé.",
        react: { "👍": ["lead1", "lead2"] }
      },
      { by: "lead2", gap: 20, text: "Ca chiều đã nhận file local đầy đủ, 14 máy ok." },
      { by: "minh", gap: 5, text: "Cảm ơn nhé 👍" },
      { by: "minh", gap: 300, text: "Tiến độ: đã copy 40%, tốc độ ổn.", react: { "🔥": ["lead2"] } }
    ]
  },
  {
    where: IT,
    date: "2026-09-20",
    time: "20:15",
    lines: [
      {
        by: "minh",
        text: "Đã copy xong dữ liệu, đang phân quyền lại theo nhóm. Sáng mai có thể còn vài thư mục thiếu quyền, ai bị thì báo ở đây kèm tên thư mục nhé.",
        react: { "👍": ["lead1", "linh"] }
      },
      {
        by: "boss",
        gap: 25,
        text: "Vất vả rồi Minh. Mai đi làm muộn chút cũng được.",
        react: { "❤️": ["minh", "linh"] }
      },
      {
        by: "minh",
        gap: 4,
        text: "Dạ em cảm ơn anh, mai em có mặt 7h để hỗ trợ ca sáng ạ.",
        react: { "👏": ["boss", "linh", "admin"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-21",
    time: "07:40",
    lines: [
      {
        by: "nv01",
        text: "Anh Minh ơi em vào ổ S: báo “Access denied” ạ 😥",
        files: [{ name: "loi-access-denied-o-S.png", hint: "screenshot Windows Explorer báo không có quyền truy cập thư mục mạng SanXuat" }],
        react: { "👀": ["minh"] },
        thread: [
          { by: "nv05", gap: 2, text: "Em cũng bị y vậy ạ." },
          { by: "nv13", gap: 3, text: "Máy em vào được ổ S nhưng thư mục đơn Úc tuần trước trống trơn ạ 😱" },
          {
            by: "minh",
            gap: 4,
            text: "Anh thấy rồi, group SanXuat chưa được gán quyền xuống thư mục con. Đang sửa, 15 phút nữa mọi người thử lại."
          },
          {
            by: "minh",
            gap: 18,
            text: "Thử lại giúp anh nhé, nhớ ngắt ổ mạng rồi vào lại (hoặc khởi động lại máy)."
          },
          { by: "nv01", gap: 4, text: "Vào được rồi ạ 👍" },
          { by: "nv13", gap: 3, text: "Thư mục đơn Úc hiện đủ file rồi anh ơi.", react: { "👍": ["minh"] } }
        ]
      },
      { by: "lead1", gap: 30, text: "Ca A còn 3 máy không thấy ổ S: trong This PC luôn." },
      { by: "nv07", gap: 3, text: "Em bị mất ổ Q: (QC) ạ, không mở được checklist." },
      {
        by: "acc1",
        gap: 5,
        text: "Thư mục khách hàng bên account không thấy dữ liệu tháng 8, khách đang hỏi lại file cũ 😥",
        react: { "😮": ["acc2"] }
      },
      {
        by: "khoa",
        gap: 6,
        text: "Ổ Q: retoucher đang có quyền xóa file, cái này không được Minh, QC cần chỉ đọc."
      },
      {
        by: "minh",
        gap: 4,
        text: "Dạ em ghi nhận hết, đang làm theo thứ tự:\n\n1. Quyền ghi SanXuat ✅\n2. Thư mục khách hàng\n3. Ổ Q: chỉ đọc cho retoucher\n4. Map ổ cho mấy máy còn thiếu\n\nCho em 1 tiếng ạ.",
        react: { "🙏": ["lead1", "acc1", "khoa"] }
      },
      {
        by: "nv11",
        gap: 10,
        text: "Photoshop báo lỗi khi lưu file lên NAS: “Could not save because write access was not granted” ạ",
        files: [{ name: "loi-luu-file-nas.png", hint: "screenshot lỗi Photoshop 'write access was not granted' khi lưu lên ổ mạng" }]
      },
      { by: "lead2", gap: 3, text: "Em lưu tạm ổ D, lát quyền ok thì chép lên nhé.", react: { "👍": ["nv11"] } }
    ]
  },
  {
    where: IT,
    date: "2026-09-21",
    time: "10:30",
    lines: [
      {
        by: "minh",
        text: "Cập nhật tình trạng NAS mới:\n\n[x] Quyền ghi thư mục SanXuat\n[x] Thư mục khách hàng tháng 8 (đã hiện lại)\n[x] Ổ Q: chuyển về chỉ đọc cho retoucher\n[ ] Map ổ tự động cho máy còn thiếu\n[ ] Kiểm tra quyền thư mục Marketing, Hành chính\n\nAi còn lỗi khác ngoài danh sách này thì báo tiếp nhé.",
        react: { "👍": ["linh", "khoa", "lead1", "acc1"], "🙏": ["nv07"] },
        thread: [
          { by: "khoa", gap: 15, text: "Ổ Q: ok rồi, cảm ơn Minh." },
          { by: "an", gap: 20, text: "Thư mục Marketing em vào được nhưng không lưu được anh ơi." },
          { by: "minh", gap: 6, text: "Sửa rồi An, thử lại nhé.", react: { "🙏": ["an"] } }
        ]
      },
      {
        by: "linh",
        gap: 55,
        text: "Minh vất vả rồi. Có lỗi nào ảnh hưởng tới đơn giao hôm nay không em?"
      },
      {
        by: "minh",
        gap: 4,
        text: "Dạ không chị, ca A giao đúng giờ hết ạ.",
        react: { "👏": ["linh", "boss"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-21",
    time: "14:00",
    lines: [
      { by: "nv15", text: "Ổ S: của em đổi ký tự, giờ hiện thành ổ Z: ạ, các shortcut cũ không chạy." },
      { by: "nv06", gap: 4, text: "Máy em cũng vậy ạ." },
      { by: "nv11", gap: 3, text: "+1 ạ 😅" },
      {
        by: "minh",
        gap: 6,
        text: "Mọi người chạy file `map-o-mang.bat` trong thư mục IT ở Desktop (anh vừa đẩy xuống mọi máy), chạy xong khởi động lại là về đúng S: Q: K: nhé.",
        react: { "👍": ["nv15", "nv06", "nv11", "lead2"] }
      },
      { by: "nv15", gap: 10, text: "Về ổ S: rồi ạ, shortcut chạy lại rồi 🙏" },
      { by: "lead2", gap: 15, text: "Ca B máy nào cũng chạy file đó rồi, ok hết.", react: { "✅": ["minh"] } }
    ]
  },
  {
    where: IT,
    date: "2026-09-22",
    time: "09:00",
    lines: [
      {
        by: "minh",
        text: "Tổng kết chuyển NAS:\n\n- Dữ liệu chuyển đủ, không mất file nào\n- Mở PSB 3GB: từ 4–5 phút xuống còn khoảng 40 giây\n- Còn 2 máy cũ chưa map ổ tự động, chiều nay anh xử lý\n\nCảm ơn mọi người đã kiên nhẫn sáng hôm qua 🙏",
        react: { "🔥": ["lead1", "lead2", "nv10"], "👏": ["linh", "khoa", "admin"] }
      },
      {
        by: "boss",
        gap: 30,
        text: "Tốt lắm Minh. Mở file nhanh vậy là năng suất tăng rõ. Cảm ơn em.",
        react: { "❤️": ["minh"], "👍": ["linh"] }
      },
      { by: "nv10", gap: 10, text: "Công nhận mở file giờ nhanh thật ạ 😍" }
    ]
  },
  {
    where: IT,
    date: "2026-09-23",
    time: "10:00",
    lines: [
      {
        by: "khoa",
        text: "Minh ơi, máy QC số 2 Photoshop cứ treo khi mở file PSB trên 5GB, NAS mới cũng vậy.",
        files: [{ name: "photoshop-not-responding.png", hint: "screenshot Photoshop (Not Responding) khi mở file PSB lớn" }],
        thread: [
          {
            by: "minh",
            gap: 12,
            text: "Máy QC 2 chỉ có 16GB RAM anh ạ, file trên 5GB là quá sức. Anh tạm dùng máy QC 1 cho file lớn nhé."
          },
          { by: "khoa", gap: 5, text: "Ok. Nhưng nên nâng RAM máy QC 2, tuần nào QC cũng gặp file nặng." },
          { by: "minh", gap: 4, text: "Dạ em đưa vào đề xuất mua sắm tháng 10, gửi chị Linh duyệt." },
          { by: "linh", gap: 30, text: "Chị duyệt rồi, Minh đặt hàng luôn nhé.", react: { "👍": ["minh", "khoa"] } }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-09-28",
    time: "08:45",
    lines: [
      {
        by: "nv04",
        text: "Đi Vũng Tàu về máy văn phòng bắt đăng nhập lại, mà em quên luôn mật khẩu Nesso Work 😂 (em nhắn bằng điện thoại)",
        react: { "😂": ["nv02", "nv09", "admin", "lead1"] }
      },
      { by: "admin", gap: 5, text: "Haha, reset rồi nha, kiểm tra tin nhắn riêng." },
      { by: "nv09", gap: 2, text: "Đầu óc vẫn còn ở biển 😂", react: { "😂": ["nv04"] } },
      { by: "nv02", gap: 2, text: "Ảnh hoàng hôn Vũng Tàu nè mọi người 🌅", deleted: true },
      { by: "nv02", gap: 1, text: "Ơ nhầm kênh 😅 qua tan-gau đăng lại" },
      { by: "nv04", gap: 3, text: "Vào được rồi ạ, cảm ơn 🙏", react: { "👍": ["admin"] } }
    ]
  },
  {
    where: IT,
    date: "2026-09-29",
    time: "15:00",
    lines: [
      {
        by: "hanh",
        text: "Anh Minh ơi mai em kết thúc thực tập. Em đã chép hết file thiết kế, báo cáo vào `Marketing/Ban-giao/Hanh`, anh kiểm tra giúp em chị An đã đủ quyền chưa ạ?"
      },
      { by: "minh", gap: 15, text: "Chị An vào được đầy đủ rồi. Laptop em trả cho hành chính chiều mai là xong nhé." },
      {
        by: "admin",
        gap: 5,
        text: "Tài khoản Nesso Work của Hạnh mình sẽ khóa cuối ngày 30/9 nha. Cảm ơn em thời gian qua 🌸",
        react: { "❤️": ["hanh", "minh"] }
      },
      { by: "hanh", gap: 3, text: "Dạ em cảm ơn anh chị ạ 🙏" }
    ]
  },
  {
    where: IT,
    date: "2026-10-01",
    time: "10:00",
    lines: [
      {
        by: "admin",
        text: "Thứ 2 tới (5/10) có 6 bạn retoucher mới vào, nhờ @{minh} chuẩn bị máy giúp mình nhé: 6 máy, Photoshop, Wacom, map ổ S:, tài khoản Nesso Work mình tạo.",
        react: { "👍": ["minh", "linh"] },
        thread: [
          {
            by: "minh",
            gap: 10,
            text: "Ok. Hiện có 4 máy trống, thiếu 2. Anh làm bản image chuẩn cài sẵn hết phần mềm, mỗi máy 30 phút là xong."
          },
          {
            by: "linh",
            gap: 15,
            text: "2 máy còn thiếu chị đã duyệt mua, thứ 3 tuần sau giao. Tạm cho 2 bạn học quy trình trước."
          },
          { by: "lead1", gap: 8, text: "Ca A nhận 3 bạn, ca B nhận 3 bạn nha. Bút Wacom dùng loại nào?" },
          { by: "minh", gap: 4, text: "Loại size M như mọi người, kho còn sẵn 6 cây." }
        ]
      },
      {
        by: "boss",
        gap: 60,
        text: "Chuẩn bị đủ đồ trước khi người mới đến. Ngày đầu mà ngồi chờ máy là ấn tượng xấu.",
        react: { "👍": ["minh", "admin", "linh"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-10-02",
    time: "16:00",
    lines: [
      {
        by: "nv08",
        text: "Windows vừa cập nhật xong, bút Wacom mất lực nhấn hoàn toàn, nét nào cũng đậm như nhau ạ 😭",
        react: { "😮": ["nv03"] },
        thread: [
          {
            by: "minh",
            gap: 8,
            text: "Lại là bản cập nhật đó 😤 Em vào Wacom Tablet Properties, bỏ tick rồi tick lại “Use Windows Ink” giúp anh."
          },
          { by: "nv08", gap: 5, text: "Vẫn không được anh ơi." },
          { by: "minh", gap: 6, text: "Ok anh remote vào cài lại driver, em lưu file nhé." },
          { by: "minh", gap: 25, text: "Xong rồi, em thử lại xem." },
          { by: "nv08", gap: 3, text: "Được rồi ạ!! Em cảm ơn anh 🙏", react: { "👍": ["minh"] } }
        ]
      },
      {
        by: "minh",
        gap: 60,
        text: "Mọi người lưu ý: anh đã **tạm hoãn cập nhật Windows** cho toàn bộ máy sản xuất 2 tuần, khi nào driver Wacom ổn anh mới mở lại. Máy nào hiện thông báo đòi cập nhật thì bấm hoãn giúp anh.",
        react: { "👍": ["lead1", "lead2", "nv08", "nv03"], "🙏": ["khoa"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-10-05",
    time: "08:30",
    lines: [
      {
        by: "boss",
        text: "Minh ơi tối qua anh ở nhà vào VPN không được, báo lỗi chứng chỉ gì đó. Anh cần xem báo cáo trên NAS.",
        files: [{ name: "vpn-loi-chung-chi.png", hint: "screenshot ứng dụng VPN báo lỗi certificate expired" }],
        thread: [
          {
            by: "minh",
            gap: 5,
            text: "Dạ chứng chỉ VPN trên laptop anh hết hạn hôm 1/10. Em gia hạn bên máy chủ rồi nhưng máy anh còn bản cũ, anh đưa em laptop 5 phút là xong ạ."
          },
          { by: "boss", gap: 10, text: "Ok anh để laptop trên bàn, lên lấy đi." },
          {
            by: "minh",
            gap: 15,
            text: "Xong rồi anh, em đã thử kết nối VPN qua 4G được ạ.",
            react: { "👍": ["boss"] }
          }
        ]
      },
      {
        by: "minh",
        gap: 30,
        text: "Ai cài VPN trên laptop trước tháng 9 thì cũng sẽ bị lỗi giống sếp, cần cài lại chứng chỉ. Danh sách em có rồi, em nhắn từng người.",
        edited: "Ai cài VPN trên laptop trước tháng 9 thì cũng sẽ bị lỗi giống sếp, cần cài lại chứng chỉ. Danh sách anh có rồi, anh nhắn từng người nhé.",
        react: { "👍": ["acc1", "linh", "acc2"] }
      },
      { by: "acc1", gap: 6, text: "Em có trong danh sách đó chắc luôn 😅" },
      { by: "minh", gap: 2, text: "Có em đó, chiều nay qua bàn anh nhé.", react: { "😂": ["acc1"] } }
    ]
  },
  {
    where: IT,
    date: "2026-10-06",
    time: "11:00",
    lines: [
      {
        by: "acc2",
        text: "Thứ 5 này mình có cuộc gọi video với khách Nhật trial, phòng họp nhỏ có webcam với mic ổn không anh Minh?"
      },
      {
        by: "minh",
        gap: 10,
        text: "Webcam phòng nhỏ hơi mờ. Anh chuyển tạm webcam 4K của phòng lớn qua, mic thì dùng loa hội nghị nhé."
      },
      { by: "acc2", gap: 3, text: "Dạ cảm ơn anh, chiều thứ 4 mình test thử được không ạ?" },
      { by: "minh", gap: 2, text: "Ok, 16h thứ 4 nha.", react: { "👍": ["acc2"] } },
      {
        by: "lead2",
        gap: 40,
        text: "Wifi khách hôm nay yếu quá, đoàn khách tham quan xưởng than không vào mạng được."
      },
      {
        by: "minh",
        gap: 8,
        text: "Bộ phát wifi khách bị treo, anh khởi động lại rồi. Mạng `Nesso-Guest` tách riêng với mạng nội bộ nên không ảnh hưởng NAS. Cuối tháng anh thay bộ phát mới.",
        react: { "👍": ["lead2", "linh"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-10-07",
    time: "14:00",
    lines: [
      {
        by: "an",
        text: "Anh Minh ơi em cần gửi file video reels 4K (2,5GB) cho bên in standee, gửi bằng gì ạ?"
      },
      {
        by: "minh",
        gap: 8,
        text: "Dùng share link NAS như hướng dẫn hôm trước nhé An, đặt hạn 3 ngày. Anh đã ghim hướng dẫn trong [tài liệu IT](https://nesso.example/wiki/it/gui-file-lon).",
        react: { "🙏": ["an"] }
      },
      {
        by: "linh",
        gap: 25,
        text: "Minh ơi chị upload ảnh HEIC từ iPhone vào task vẫn không có ảnh xem trước. Khách Nhật cũng hay gửi HEIC.",
        thread: [
          {
            by: "minh",
            gap: 8,
            text: "Dạ app vẫn chưa hỗ trợ preview HEIC chị ạ. Em đang làm chế độ tự chuyển sang JPG khi upload từ điện thoại, dự kiến có trong bản cập nhật tuần sau."
          },
          {
            by: "linh",
            gap: 3,
            text: "Ok, trước mắt chị đổi định dạng chụp trên iPhone sang “Most Compatible” vậy."
          },
          { by: "minh", gap: 2, text: "Đúng rồi chị, vậy là máy chụp ra JPG luôn.", react: { "👍": ["linh", "acc2"] } }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-10-08",
    time: "09:30",
    lines: [
      {
        by: "minh",
        text: "## Chính sách sao lưu dữ liệu (áp dụng từ 8/10)\n- NAS mới tự tạo **snapshot mỗi đêm** lúc 2h, giữ 14 ngày\n- **Sao lưu ngoài** (offsite) mỗi thứ 7\n- File trên Desktop / ổ C máy cá nhân **không được sao lưu**\n- Lỡ xóa file trên NAS: báo anh trong vòng 14 ngày là khôi phục được\n\nMọi người tập thói quen lưu file trên NAS giúp anh nhé.",
        react: { "👍": ["linh", "admin", "lead1", "khoa"], "✅": ["boss"] },
        thread: [
          { by: "nv12", gap: 20, text: "Anh ơi thư mục WIP cũng được snapshot luôn hả anh?" },
          { by: "minh", gap: 3, text: "Có em, toàn bộ ổ S: Q: K:.", react: { "👍": ["nv12"] } }
        ]
      },
      { by: "boss", gap: 60, text: "Quy định này đưa vào tài liệu hướng dẫn nhân viên mới luôn nhé @{admin}." },
      {
        by: "admin",
        gap: 5,
        text: "Dạ anh, em cập nhật vào bộ tài liệu onboarding trong hôm nay ạ.",
        react: { "👍": ["boss"] }
      }
    ]
  },
  {
    where: IT,
    date: "2026-10-09",
    time: "10:15",
    lines: [
      {
        by: "nv13",
        text: "Màn hình máy 9 cứ chớp tắt liên tục, nhìn đau mắt quá ạ.",
        files: [{ name: "man-hinh-chop.jpg", hint: "ảnh chụp màn hình máy tính bị sọc ngang và chớp" }],
        thread: [
          { by: "minh", gap: 10, text: "Em thử thay dây DisplayPort dự phòng anh để trong hộp dưới bàn xem." },
          { by: "nv13", gap: 8, text: "Thay dây rồi vẫn chớp ạ 😢" },
          {
            by: "minh",
            gap: 4,
            text: "Vậy là hỏng màn rồi. Trưa nay anh đổi màn mới cho em, hôm qua vừa về hàng, calibrate sẵn rồi."
          },
          { by: "nv13", gap: 120, text: "Màn mới xịn quá anh ơi, cảm ơn anh 😍", react: { "❤️": ["minh"], "👍": ["khoa"] } }
        ]
      }
    ]
  },
  {
    where: IT,
    date: "2026-10-09",
    time: "15:30",
    lines: [
      {
        by: "acc1",
        text: "Khách Nhật gửi file gốc qua link tải bên họ, tốc độ chỉ khoảng 200KB/s, 3GB chắc tới tối mới xong 😩 Có cách nào nhanh hơn không anh Minh?",
        thread: [
          {
            by: "minh",
            gap: 8,
            text: "Máy chủ của link đó đặt bên Nhật, giờ cao điểm hay chậm. Em gửi anh link, anh cho NAS tải trực tiếp về, không phụ thuộc máy em."
          },
          { by: "acc1", gap: 3, text: "Dạ em gửi qua tin riêng ạ." },
          {
            by: "minh",
            gap: 40,
            text: "Tải xong rồi, 3GB mất 25 phút. File ở `K:\\KhachNhat\\Trial-02`.",
            react: { "🔥": ["acc1", "acc2"] }
          }
        ]
      },
      {
        by: "acc1",
        gap: 60,
        text: "@{boss} anh ơi, khách Nhật muốn mình nhận/gửi file qua hệ thống chia sẻ của họ, phải đồng ý điều khoản bảo mật của họ. Anh xem giúp em tài liệu này trước khi em bấm đồng ý ạ.",
        files: [{ name: "dieu-khoan-chia-se-file-khach-Nhat.pdf", hint: "điều khoản bảo mật hệ thống chia sẻ file của khách, bản tiếng Anh" }],
        react: { "👀": ["minh"] }
      },
      {
        by: "minh",
        gap: 20,
        text: "Phần kỹ thuật em đọc rồi: họ yêu cầu chỉ truy cập từ IP cố định của văn phòng và bật xác thực 2 lớp, mình đáp ứng được. Phần pháp lý chờ anh quyết ạ @{boss}."
      }
    ]
  },
  {
    where: IT,
    date: "2026-10-10",
    time: "08:45",
    lines: [
      {
        by: "nv03",
        text: "File PSD khách Nhật mở lên báo thiếu font, chữ trên bao bì sản phẩm bị thay sang font khác ạ.",
        files: [{ name: "thieu-font-file-khach-nhat.png", hint: "screenshot hộp thoại Photoshop báo một số layer chữ dùng font bị thiếu" }],
        react: { "👀": ["lead1", "khoa"] },
        thread: [
          {
            by: "lead1",
            gap: 6,
            text: "Đừng bấm Replace nhé, layer chữ giữ nguyên tuyệt đối.",
            edited: "Đừng bấm Replace nhé, layer chữ trên bao bì giữ nguyên tuyệt đối, đóng file không lưu."
          },
          {
            by: "minh",
            gap: 15,
            text: "Font này là font tiếng Nhật miễn phí, anh cài cho máy em và cả nhóm làm đơn Nhật rồi. Em mở lại file là đủ font."
          },
          { by: "nv03", gap: 4, text: "Mở lại hết báo lỗi rồi ạ 🙏" },
          {
            by: "khoa",
            gap: 10,
            text: "Anh ghi vào checklist đơn Nhật: mở file thấy báo thiếu font thì dừng, báo IT, không tự thay.",
            react: { "👍": ["lead1", "minh"] }
          }
        ]
      },
      { by: "nv14", gap: 40, text: "Máy em cũng làm đơn Nhật, anh cài giúp luôn được không ạ?" },
      { by: "minh", gap: 3, text: "Máy em có trong danh sách rồi, mở lại Photoshop là được nhé.", react: { "👍": ["nv14"] } }
    ]
  },
  {
    where: IT,
    date: "2026-10-10",
    time: "13:30",
    lines: [
      {
        by: "lead2",
        text: "Máy in tầng 3 báo “Paper jam” mà mở ra không thấy tờ giấy nào kẹt. Ca chiều cần in bảng phân ca 😅"
      },
      {
        by: "minh",
        gap: 10,
        text: "Chắc do cảm biến. Tắt máy in 1 phút, mở khay sau, lau nhẹ cảm biến bằng khăn khô rồi bật lại thử."
      },
      { by: "lead2", gap: 8, text: "Không ăn thua. Thôi in tạm tầng 2 vậy." },
      { by: "minh", gap: 4, text: "Ok, thứ 2 anh gọi bên bảo hành qua. @{admin} ghi vào sổ thiết bị giúp em nhé." },
      { by: "admin", gap: 30, text: "Ghi rồi nhé, sáng thứ 2 mình gọi bảo hành luôn.", react: { "👍": ["minh", "lead2"] } }
    ]
  },
  {
    where: IT,
    date: "2026-10-10",
    time: "17:50",
    lines: [
      {
        by: "nv10",
        text: "Anh Minh ơi em lưu file vào `K:\\KhachNhat\\Trial-02\\Done` không được, Photoshop báo không có quyền ghi ạ. Đơn khách Nhật hẹn giao 21h.",
        files: [{ name: "loi-quyen-ghi-khach-nhat.png", hint: "screenshot lỗi Photoshop 'write access was not granted' khi lưu vào thư mục Done" }],
        react: { "👀": ["lead2", "nv11"] }
      },
      {
        by: "lead2",
        gap: 4,
        text: "Máy khác trong ca cũng bị y vậy ở thư mục Done, các thư mục khác vẫn lưu bình thường. @{minh} xem giúp gấp nhé."
      },
      { by: "nv11", gap: 3, text: "Em cũng không lưu được vào đó ạ 😥" },
      {
        by: "minh",
        gap: 12,
        text: "Anh đang ở ngoài, tầm 19h về tới nhà anh remote vào xem. Trong lúc đó mọi người lưu tạm vào `S:\\WIP\\KhachNhat`, đặt tên đúng quy tắc, đừng lưu Desktop nhé.",
        react: { "🙏": ["nv10", "lead2"] }
      },
      { by: "nv10", gap: 5, text: "Dạ em lưu tạm vào WIP rồi ạ." },
      {
        by: "lead2",
        gap: 8,
        text: "@{acc1} báo trước để nắm: nếu 20h quyền thư mục chưa xong thì nhờ account chép file vào Done giúp, để kịp giao 21h."
      }
    ]
  }
];
