/**
 * Seed content (LOCAL DEVELOPMENT ONLY, invented data): projects "Chăm sóc khách hàng" (CSKH),
 * "Ban điều hành" (BDH, private) and "Ngân sách 2027" (NS, private).
 */
import type { ProjectSeed } from "../types.js";

export const projectsCskhBdh: ProjectSeed[] = [
  // ==========================================================================================
  // CSKH — Chăm sóc khách hàng (public)
  // ==========================================================================================
  {
    key: "CSKH",
    name: "Chăm sóc khách hàng",
    description:
      "Tiếp nhận phản hồi – khiếu nại, khách mới & đơn test, báo giá – hợp đồng và chăm sóc khách định kỳ. Mọi trao đổi quan trọng với khách cần ghi lại trên task.",
    icon: "heart",
    color: "orange",
    visibility: "public",
    owner: "acc1",
    createdOn: "2026-08-26",
    members: {
      acc1: "manage",
      acc2: "submit",
      boss: "manage",
      linh: "manage",
      lead1: "submit",
      lead2: "submit",
      khoa: "submit",
      an: "view"
    },
    workflow: [
      { name: "Mới", category: "active", color: "slate" },
      { name: "Đang xử lý", category: "active", color: "blue" },
      { name: "Chờ khách phản hồi", category: "active", color: "amber" },
      { name: "Đã giải quyết", category: "done", color: "green" },
      { name: "Đóng", category: "closed", color: "gray" }
    ],
    lists: [
      // ---------------------------------------------------------------- Phản hồi & khiếu nại
      {
        name: "Phản hồi & khiếu nại",
        description:
          "Khiếu nại chất lượng, giao trễ, yêu cầu làm lại. Mỗi khiếu nại một task, ghi rõ đơn gốc và hạn trả bản sửa.",
        color: "red",
        tasks: [
          {
            title: "Khiếu nại màu trời xanh gắt – agency BĐS Melbourne nhóm 3",
            desc: `Khách phản hồi lô 180 ảnh HDR giao ngày 16/9: trời thay vào **xanh quá gắt**, không hợp không khí mùa xuân bên Úc, nhìn "giả".

- Ảnh bị ảnh hưởng: khoảng 40/180 ảnh (chủ yếu ảnh ngoại thất chụp buổi trưa)
- Khách yêu cầu sửa trong 24h, không tính phí
- Job gốc: [HDR 180 ảnh – Melbourne nhóm 3](https://nesso.example/jobs/hdr-180-melbourne-3)

[x] Xác nhận danh sách ảnh lỗi với khách
[x] Chỉnh lại preset trời, giảm saturation
[x] QC duyệt lại toàn bộ 40 ảnh
[x] Gửi bản sửa kèm lời xin lỗi`,
            priority: "urgent",
            creator: "acc1",
            assignees: ["acc1", "khoa", "lead1"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 23,
            files: [
              { name: "phan-hoi-khach-mau-troi.jpg", hint: "before/after: bầu trời xanh gắt so với bản đã chỉnh dịu lại" }
            ],
            subtasks: [
              { title: "Lọc danh sách 40 ảnh bị trời xanh gắt", assignees: ["acc1"], status: "Đã giải quyết" },
              { title: "Chỉnh lại preset sky cho nhóm khách Melbourne", assignees: ["lead1"], status: "Đã giải quyết" },
              { title: "QC soát lại toàn bộ ảnh trước khi gửi", assignees: ["khoa"], status: "Đã giải quyết" }
            ],
            comments: [
              {
                by: "acc1",
                at: 0.05,
                text: "Khách gửi kèm 3 ảnh khoanh đỏ, em đính vào task rồi ạ. @{khoa} anh xem giúp em mức độ nhé.",
                replies: [
                  {
                    by: "khoa",
                    at: 0.15,
                    text: "Đúng là preset sky mới đẩy saturation hơi tay. Mấy hôm cao điểm các bạn chạy batch nên không soát kỹ."
                  },
                  { by: "lead1", at: 0.2, text: "Nhóm A nhận sửa, ca đêm nay xử lý xong 40 ảnh ạ." }
                ]
              },
              {
                by: "boss",
                at: 0.3,
                text: "Khách này lâu năm rồi, sửa xong gửi kèm lời xin lỗi cho đàng hoàng. @{acc1} cần thì để anh gọi trực tiếp.",
                replies: [
                  { by: "acc1", at: 0.35, text: "Dạ em cảm ơn anh, khách xem bản sửa xong em báo anh ngay ạ." }
                ]
              },
              {
                by: "khoa",
                at: 1.0,
                text: "Đã QC xong 40 ảnh, trời giờ nhẹ hơn, có mây tự nhiên. Ok gửi được.",
                edited:
                  "Đã QC xong 40/40 ảnh, trời giờ nhẹ hơn, có mây tự nhiên, cân lại cả màu cỏ cho đồng bộ. Ok gửi được."
              },
              { by: "acc1", at: 1.6, text: "Khách đã xác nhận ok, cảm ơn cả team 🙏" }
            ]
          },
          {
            title: "Gọi trực tiếp xin lỗi agency BĐS Melbourne nhóm 3 về đợt giao trễ",
            priority: "high",
            creator: "acc1",
            assignees: ["boss", "acc1"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 22,
            comments: [
              {
                by: "acc1",
                at: 0.1,
                text: "@{boss} khách muốn nói chuyện với người phụ trách, anh sắp xếp được khung 7h sáng mai (giờ VN) không ạ? Bên đó là 10h.",
                replies: [
                  {
                    by: "boss",
                    at: 0.2,
                    text: "Ok 7h anh gọi. Em gửi anh tóm tắt số ảnh trễ, số ảnh phải sửa trước 6h nhé."
                  }
                ]
              },
              {
                by: "boss",
                at: 1.05,
                text: "Gọi xong rồi. Khách thông cảm vì mùa cao điểm, nhưng nhắc lần sau trễ phải báo trước ít nhất 3 tiếng. Anh đã hứa đơn kế tiếp ưu tiên trả sớm và có người theo dõi riêng.",
                replies: [
                  { by: "acc1", at: 1.1, text: "Dạ em ghi chú vào hồ sơ khách rồi ạ." },
                  {
                    by: "linh",
                    at: 1.2,
                    text: "Chị đưa vụ báo trễ trước 3 tiếng vào quy trình điều phối luôn nhé."
                  }
                ]
              }
            ]
          },
          {
            title: "Cửa sổ bị cháy sáng, mất view ngoài – đơn HDR 240 ảnh khách Sydney",
            desc: `Khách phản hồi nhiều ảnh nội thất bị **cháy sáng cửa sổ** (window pull chưa đạt), không thấy cây và hàng rào bên ngoài.

- Nguyên nhân sơ bộ: bracket tối nhất bị bỏ qua khi blend
- Số ảnh cần sửa: 26 ảnh
- Hạn trả bản sửa: trước 14h ngày 19/9`,
            priority: "high",
            creator: "acc2",
            assignees: ["lead2", "khoa"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 22,
            subtasks: [
              "Blend lại window pull 26 ảnh từ bracket tối nhất",
              "Cập nhật hướng dẫn window pull cho nhóm B"
            ],
            comments: [
              {
                by: "lead2",
                at: 0.1,
                text: "Nhóm B nhận, em chia cho 3 bạn mỗi bạn 8–9 ảnh, dự kiến xong trước trưa mai.",
                replies: [{ by: "acc2", at: 0.15, text: "Dạ ok anh, khách hẹn check lúc 14h." }]
              },
              {
                by: "khoa",
                at: 0.6,
                text: "Gửi mọi người 1 ảnh mẫu trước/sau để làm chuẩn, ảnh sau là mức khách chấp nhận.",
                files: [
                  {
                    name: "cua-so-chay-sang-truoc-sau.jpg",
                    hint: "window pull: cửa sổ cháy trắng so với bản thấy rõ cây bên ngoài"
                  }
                ],
                replies: [
                  {
                    by: "nv05",
                    at: 0.7,
                    text: "Dạ em làm theo mẫu này, 2 ảnh phòng ngủ blend lại thấy ổn hơn nhiều ạ."
                  }
                ]
              },
              { by: "acc2", at: 1.0, text: "Khách ok cả 26 ảnh sửa. Đóng task nhé." }
            ]
          },
          {
            title: "Giao trễ 6 tiếng đơn day-to-dusk do ca đêm thiếu người",
            desc: `Đơn 60 ảnh day-to-dusk của agency Brisbane nhóm 2 giao trễ khoảng 6 tiếng so với cam kết.

## Nguyên nhân
- Ca đêm 15/9 có 2 bạn nghỉ đột xuất, không có người thay
- Account không báo khách trước khi trễ

## Hành động
[x] Gửi email xin lỗi và cập nhật thời gian giao mới
[x] Bổ sung danh sách dự phòng cho ca đêm
[x] Quy định: dự kiến trễ phải báo account trước 3 tiếng`,
            priority: "urgent",
            creator: "acc2",
            assignees: ["lead1", "acc2"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 24,
            comments: [
              {
                by: "linh",
                at: 0.2,
                text: "Tuần này đơn dồn quá, chị duyệt cho ca đêm thêm 2 người từ nhóm B. @{lead2} sắp xếp giúp chị nhé.",
                replies: [
                  { by: "lead2", at: 0.3, text: "Dạ em điều @{nv06} với @{nv07} qua ca đêm từ tối nay ạ." }
                ]
              },
              {
                by: "boss",
                at: 0.5,
                text: "Trễ thì phải báo khách trước, đừng để khách hỏi mới trả lời. Lần sau anh không muốn thấy lại chuyện này.",
                replies: [
                  {
                    by: "acc2",
                    at: 0.55,
                    text: "Dạ em rút kinh nghiệm ạ, từ giờ em đặt nhắc trước hạn 3 tiếng cho mọi đơn."
                  }
                ]
              }
            ]
          },
          {
            title: "Làm lại miễn phí 35 ảnh trời bị viền halo quanh mái nhà",
            priority: "normal",
            creator: "acc1",
            assignees: ["nv02", "nv03", "lead1"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 19,
            comments: [
              {
                by: "nv02",
                at: 0.4,
                text: "Em xong 18 ảnh, dùng refine edge rồi tô tay lại mép mái ạ.",
                replies: [{ by: "lead1", at: 0.5, text: "Ok em, nhớ zoom 200% soát mép ngói nhé." }]
              },
              {
                by: "nv03",
                at: 0.6,
                text: "17 ảnh còn lại em xong rồi ạ, đã up lên thư mục `redo/halo` trên NAS mới.",
                edited: "17 ảnh còn lại em xong rồi ạ, đã up lên thư mục `redo/halo-0921` trên NAS mới."
              }
            ]
          },
          {
            title: "Khách Mỹ mới (đơn virtual staging) chê nội thất không hợp phong cách",
            desc: `Khách Mỹ mới (đơn virtual staging 12 phòng) phản hồi: nội thất mình dàn **tông gỗ tối, cổ điển**, trong khi căn nhà nhắm tới người mua trẻ.

Yêu cầu của khách:
- Phong cách Scandinavian, gỗ sáng, vải màu kem/xám nhạt
- Thêm cây xanh, bớt đồ trang trí rườm rà
- Giữ nguyên góc máy và ánh sáng tự nhiên

Moodboard khách gửi: [moodboard virtual staging](https://example.com/moodboard/scandi-living)

@{boss} đây là khách đầu tiên của thị trường Mỹ, em đề xuất làm lại miễn phí toàn bộ 12 phòng.`,
            priority: "high",
            creator: "acc2",
            assignees: ["acc2", "nv08", "nv09"],
            status: "Đang xử lý",
            due: "tomorrow",
            createdDaysAgo: 4,
            subtasks: [
              { title: "Làm lại phòng khách và bếp (4 ảnh)", assignees: ["nv08"], status: "Đang xử lý" },
              { title: "Làm lại 3 phòng ngủ và phòng làm việc (5 ảnh)", assignees: ["nv09"], status: "Đang xử lý" },
              { title: "Dựng lại 3 ảnh sân sau và ban công", assignees: ["nv08"], status: "Mới" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.2,
                text: "Đồng ý làm lại miễn phí. Nhưng lần sau khách mới phải hỏi style trước khi làm, đừng đoán.",
                replies: [
                  { by: "acc2", at: 0.25, text: "Dạ em sẽ thêm câu hỏi về style vào form onboarding ạ." },
                  {
                    by: "linh",
                    at: 0.3,
                    text: "Chị nhắc thêm: gửi 1 phòng mẫu cho khách duyệt trước rồi mới làm hàng loạt."
                  }
                ]
              },
              {
                by: "nv08",
                at: 1.5,
                text: "Em làm xong phòng khách mẫu theo moodboard, anh chị xem giúp em trước khi gửi khách ạ.",
                replies: [
                  {
                    by: "khoa",
                    at: 1.6,
                    text: "Tông kem ổn rồi, nhưng tấm thảm hơi to so với phòng, em thu nhỏ khoảng 15% nhé."
                  },
                  { by: "nv08", at: 1.7, text: "Dạ em sửa rồi ạ." }
                ]
              },
              {
                by: "acc2",
                at: 3.4,
                text: "Khách duyệt phòng mẫu rồi 👍 @{nv09} làm tiếp các phòng ngủ theo đúng tông này nha.",
                replies: [{ by: "nv09", at: 3.5, text: "Dạ, mai em xong ạ." }]
              },
              {
                by: "acc2",
                at: 3.9,
                text: "@{boss} khách khen bản mẫu mới, nói nếu ổn sẽ đặt tiếp 3 căn trong tháng này ạ."
              }
            ]
          },
          {
            title: "Làm lại 8 ảnh bị lệch đường thẳng đứng – khách Adelaide",
            priority: "normal",
            creator: "acc1",
            assignees: ["nv05", "lead1"],
            status: "Mới",
            due: "week",
            createdDaysAgo: 1,
            comments: [
              {
                by: "acc1",
                at: 0.2,
                text: "Khách báo tường với khung cửa bị nghiêng, rõ nhất ở 2 ảnh bếp. @{nv05} xử lý giúp mình bằng guided upright nhé.",
                replies: [{ by: "nv05", at: 0.3, text: "Dạ ok, sáng thứ 2 em làm luôn ạ." }]
              }
            ]
          },
          {
            title: "Sửa lại cửa sổ bị cháy sáng 18 ảnh – agency Brisbane nhóm 2",
            desc: `Khách gửi lại 18 ảnh, cửa sổ vẫn cháy dù đã blend. Khách cần trước **17h thứ 7 (10/10)** giờ VN để kịp đăng listing.

[x] Nhận lại file gốc kèm đủ bracket
[ ] Blend lại window pull
[ ] QC soát cùng anh @{khoa}
[ ] Gửi khách`,
            priority: "urgent",
            creator: "acc1",
            assignees: ["nv01", "nv04", "lead2"],
            status: "Đang xử lý",
            due: "today",
            createdDaysAgo: 3,
            comments: [
              {
                by: "lead2",
                at: 0.1,
                text: "@{nv01} làm 9 ảnh đầu, @{nv04} 9 ảnh sau nhé. Ai xong trước thì báo.",
                replies: [
                  { by: "nv01", at: 2.6, text: "Em xong 9 ảnh rồi ạ." },
                  {
                    by: "nv04",
                    at: 2.8,
                    text: "Em còn 2 ảnh phòng tắm có kính phản chiếu hơi khó, chiều nay xong ạ."
                  }
                ]
              },
              { by: "khoa", at: 2.9, text: "Đã soát 9 ảnh của @{nv01}, ok. Chờ phần còn lại." },
              {
                by: "acc1",
                at: 2.95,
                text: "Khách hỏi tiến độ, mình báo là 17h có đủ nhé @{lead2}.",
                replies: [{ by: "lead2", at: 2.97, text: "Ok, kịp." }]
              }
            ]
          },
          {
            title: "Làm lại màu tường bị ám vàng sau khi cân trắng – đơn 60 ảnh căn hộ",
            priority: "normal",
            creator: "acc2",
            assignees: ["nv07", "nv10"],
            status: "Mới",
            due: "week",
            createdDaysAgo: 2
          },
          {
            title: "Xoá vật thể sót (thùng rác, dây điện) theo phản hồi khách Perth",
            priority: "normal",
            creator: "acc1",
            assignees: ["nv11", "nv12"],
            status: "Chờ khách phản hồi",
            due: "none",
            createdDaysAgo: 7,
            comments: [
              { by: "nv11", at: 1.0, text: "Em xoá xong thùng rác ở 5 ảnh mặt tiền rồi ạ." },
              {
                by: "nv12",
                at: 1.2,
                text: "Ảnh sân sau có dây điện vắt ngang trời, khách có muốn xoá luôn không ạ? Xoá thì phải dựng lại một đoạn mái.",
                replies: [
                  {
                    by: "acc1",
                    at: 1.4,
                    text: "Mình đã hỏi khách, đang chờ trả lời. Tạm thời giữ nguyên nhé."
                  }
                ]
              }
            ]
          },
          {
            title: "Làm lại 9 ảnh day-to-dusk bị đèn trong nhà quá vàng",
            desc: `Khách góp ý đèn trong nhà bật lên **vàng cam quá**, nhìn như cháy. Muốn ánh đèn ấm nhưng trung tính hơn, trời hoàng hôn giữ nguyên.

- Mẫu tham khảo: [dusk ấm trung tính](https://nesso.example/style/dusk-warm-neutral)
- Gợi ý: nhiệt màu đèn khoảng 3000K, giảm glow quanh cửa sổ`,
            priority: "urgent",
            creator: "acc2",
            assignees: ["nv13", "nv14", "nv15"],
            status: "Đang xử lý",
            due: "overdue",
            createdDaysAgo: 7,
            subtasks: [
              {
                title: "Chỉnh lại đèn 9 ảnh theo mẫu dusk trung tính",
                assignees: ["nv13", "nv14"],
                status: "Đang xử lý"
              },
              { title: "Soát glow cửa sổ và gửi khách duyệt", assignees: ["nv15"], status: "Mới" }
            ],
            comments: [
              { by: "acc2", at: 0.2, text: "Khách cần trước thứ 4 nha mọi người." },
              {
                by: "nv14",
                at: 2.0,
                text: "Em làm thử 1 ảnh, anh chị xem tông đèn này đã ổn chưa ạ?",
                replies: [
                  { by: "khoa", at: 2.1, text: "Vẫn hơi cam, kéo về trung tính thêm chút, giảm glow khoảng 30%." },
                  { by: "nv14", at: 2.2, text: "Dạ em chỉnh lại ạ." }
                ]
              },
              {
                by: "linh",
                at: 5.5,
                text: "Khách hỏi lại rồi đó, đơn này đang vướng gì vậy @{acc2}?",
                replies: [
                  {
                    by: "acc2",
                    at: 5.6,
                    text: "Dạ khách đổi ý 2 lần về độ sáng trời, giờ đã chốt mẫu. Tối nay nhóm làm xong ạ."
                  },
                  { by: "nv13", at: 5.8, text: "Em còn 3 ảnh, khoảng 8h tối là xong ạ." }
                ]
              }
            ]
          },
          {
            title: "Khách phàn nàn file giao bị đặt tên sai quy ước",
            priority: "low",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 30
          },
          {
            title: "Tổng hợp nguyên nhân khiếu nại đợt cao điểm 14–19/9",
            desc: `Tổng hợp toàn bộ khiếu nại trong tuần cao điểm để rút kinh nghiệm trước mùa cao điểm tiếp theo.

## Kết quả sơ bộ
- Màu trời / sky replacement: khoảng 40% số khiếu nại
- Cửa sổ cháy sáng (window pull): khoảng 30%
- Giao trễ: khoảng 20%
- Khác (đặt tên file, thiếu ảnh): khoảng 10%

## Đề xuất
1. Thêm bước soát trời và cửa sổ vào QC checklist v2
2. Mỗi ca đêm có ít nhất 1 người QC
3. Account đặt nhắc trước hạn 3 tiếng

@{boss} @{linh} mời anh chị xem để đưa vào giao ban tuần sau.`,
            priority: "high",
            creator: "khoa",
            assignees: ["khoa", "linh"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 18,
            files: [
              {
                name: "tong-hop-khieu-nai-dot-cao-diem-14-19-9.xlsx",
                hint: "bảng khiếu nại theo loại lỗi, nhóm khách, ngày nhận, người xử lý"
              }
            ],
            comments: [
              {
                by: "boss",
                at: 0.4,
                text: "Số liệu rõ ràng. Anh đồng ý cả 3 đề xuất, @{khoa} đưa vào checklist v2 luôn nhé.",
                replies: [
                  {
                    by: "khoa",
                    at: 0.5,
                    text: "Dạ, em cập nhật bản v2 và triển khai từ 5/10 cùng đợt kickoff quý 4 ạ."
                  }
                ]
              },
              {
                by: "linh",
                at: 1.0,
                text: "Chị bổ sung: đề xuất 2 cần có phụ cấp cho QC ca đêm, chị sẽ đưa vào chính sách làm thêm giờ."
              }
            ]
          },
          {
            title: "Đề xuất chính sách làm lại miễn phí: giới hạn số lần và thời hạn",
            desc: `Hiện khách yêu cầu làm lại bao nhiêu lần mình cũng làm, kể cả khi do khách đổi yêu cầu. Cần quy định rõ:

- Lỗi do mình: làm lại miễn phí, không giới hạn, trong 7 ngày
- Khách đổi yêu cầu sau khi đã duyệt: tối đa 1 lần miễn phí
- Quá 7 ngày: tính như đơn mới

[ ] Lấy ý kiến bên QC
[ ] Trình anh giám đốc duyệt
[ ] Cập nhật vào hợp đồng mẫu`,
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1", "linh"],
            status: "Đang xử lý",
            due: "next_week",
            createdDaysAgo: 9,
            comments: [
              {
                by: "khoa",
                at: 1.0,
                text: "Bên QC đồng ý. Thêm ý: khi làm lại phải ghi rõ lỗi thuộc loại nào để còn thống kê.",
                replies: [
                  { by: "acc1", at: 1.1, text: "Hay đó anh, mình thêm cột phân loại lỗi vào form làm lại." }
                ]
              },
              {
                by: "linh",
                at: 3.0,
                text: "Bản này ổn, đợi gom với điều khoản bảo mật rồi trình @{boss} một lượt nhé."
              }
            ]
          },
          {
            title: "Khiếu nại màu trời agency Melbourne nhóm 3 (trùng, đã gộp)",
            priority: "low",
            creator: "acc2",
            assignees: [],
            status: "Đóng",
            due: "none",
            createdDaysAgo: 22,
            trash: true
          }
        ]
      },

      // ---------------------------------------------------------------- Khách hàng mới & dùng thử
      {
        name: "Khách hàng mới & dùng thử",
        description: "Khách mới, đơn test miễn phí, onboarding và gửi mẫu style.",
        color: "sky",
        tasks: [
          {
            title: "Test miễn phí 10 ảnh cắt nền sản phẩm cho khách Nhật mới",
            desc: `Khách Nhật mới (bán đồ gia dụng trên sàn thương mại điện tử) gửi 10 ảnh test. Khách **rất khắt khe về viền**: soi ở 400%, không chấp nhận răng cưa hay viền trắng.

## Yêu cầu kỹ thuật
- Cắt nền bằng path tay (clipping path), không dùng auto select
- Nền trắng tuyệt đối \`#FFFFFF\`, giữ bóng đổ tự nhiên
- Xuất TIFF 300dpi + JPG, giữ nguyên path trong file
- Hạn trả bản test: 3 ngày làm việc

Guideline của khách: [guideline cắt nền](https://example.com/guideline/product-cutout-jp)

[x] Nhận đủ 10 ảnh gốc
[x] Phân công 3 bạn tay path chắc nhất
[x] QC soi viền 300–400%
[x] Gửi bản test
[ ] Nhận góp ý của khách`,
            priority: "urgent",
            creator: "acc1",
            assignees: ["acc1", "khoa", "lead1"],
            status: "Chờ khách phản hồi",
            due: "week",
            createdDaysAgo: 5,
            files: [
              {
                name: "huong-dan-cat-nen-khach-nhat.pdf",
                hint: "guideline cắt nền sản phẩm: viền, bóng đổ, nền trắng, định dạng xuất file"
              }
            ],
            subtasks: [
              {
                title: "Đọc guideline và tóm tắt điểm khác so với khách cũ",
                assignees: ["acc1"],
                status: "Đã giải quyết"
              },
              { title: "Cắt nền 10 ảnh bằng path tay", assignees: ["lead1"], status: "Đã giải quyết" },
              { title: "QC soi viền ở 300–400%", assignees: ["khoa"], status: "Đã giải quyết" },
              { title: "Sửa 4 ảnh theo góp ý của khách", assignees: ["lead1"], status: "Đang xử lý" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Khách Nhật này tiềm năng lớn, ưu tiên số 1 tuần này. Chọn người tay path chắc nhất, đừng ham nhanh.",
                replies: [
                  {
                    by: "lead1",
                    at: 0.2,
                    text: "Dạ em giao cho @{nv02}, @{nv03}, @{nv06} – 3 bạn này path đều tay nhất nhóm ạ."
                  },
                  { by: "boss", at: 0.25, text: "Ok 👍" }
                ]
              },
              {
                by: "khoa",
                at: 2.1,
                text: "Soi viền xong 10 ảnh. Lưu ý ảnh số 7 (ấm siêu tốc) tay cầm cong, path phải bám sát, em sửa lại rồi.",
                files: [
                  {
                    name: "test-khach-nhat-10-anh-truoc-sau.jpg",
                    hint: "ảnh sản phẩm trước/sau cắt nền, khung zoom 400% vào viền"
                  }
                ]
              },
              { by: "acc1", at: 2.6, text: "Đã gửi bản test cho khách lúc 15h ạ." },
              {
                by: "acc1",
                at: 3.3,
                text: "Khách phản hồi: 6/10 ảnh đạt, 4 ảnh còn lỗi ở lông bàn chải và bóng đổ hơi gắt. Mình tạo task sửa riêng rồi nhé.",
                replies: [
                  {
                    by: "boss",
                    at: 3.4,
                    text: "6/10 lần đầu là được rồi. Sửa kỹ 4 ảnh, gửi lại khách trong thứ 7 nhé."
                  },
                  { by: "khoa", at: 3.5, text: "Em sẽ tự soát lại 4 ảnh này." }
                ]
              },
              {
                by: "linh",
                at: 4.7,
                text: "@{boss} khách Nhật hẹn tuần sau họp online về báo giá nếu bản sửa đạt, anh sắp xếp tham gia được không ạ?"
              }
            ]
          },
          {
            title: "Làm lại viền và bóng đổ 4 ảnh test theo góp ý khách Nhật",
            desc: `Góp ý của khách cho 4 ảnh:
- Ảnh 2, 5: lông bàn chải bị cắt cụt, mất chi tiết
- Ảnh 7: bóng đổ quá đậm, cạnh bóng quá sắc
- Ảnh 9: còn 1px viền trắng ở mép dưới

> Khách nhấn mạnh: thà làm chậm nhưng không được sót viền.`,
            priority: "high",
            creator: "acc1",
            assignees: ["nv02", "nv03", "nv06"],
            status: "Đang xử lý",
            due: "today",
            createdDaysAgo: 2,
            comments: [
              {
                by: "nv02",
                at: 0.3,
                text: "Em nhận ảnh 2 và 5, phần lông bàn chải em tách bằng channel rồi tô mask tay ạ."
              },
              {
                by: "nv06",
                at: 0.4,
                text: "Em làm ảnh 7, bóng đổ em dựng lại bằng layer riêng cho dễ chỉnh ạ.",
                replies: [
                  {
                    by: "khoa",
                    at: 0.6,
                    text: "Bóng giữ độ mềm khoảng 60%, đừng dùng drop shadow có sẵn nhé."
                  }
                ]
              },
              {
                by: "nv03",
                at: 1.2,
                text: "Ảnh 9 em sửa xong, đã soát 400% không còn viền ạ.",
                edited: "Ảnh 9 em sửa xong, đã soát 400% cả 4 cạnh, không còn viền ạ."
              },
              {
                by: "khoa",
                at: 1.9,
                text: "Đã duyệt 3/4 ảnh. Ảnh 5 còn vài sợi lông bị mờ, @{nv02} làm lại đoạn đó, xong trước 17h hôm nay nhé.",
                replies: [{ by: "nv02", at: 1.95, text: "Dạ em đang sửa ạ." }]
              }
            ]
          },
          {
            title: "Soạn bộ ảnh mẫu style (before/after) gửi khách tiềm năng",
            priority: "normal",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 35,
            files: [
              {
                name: "bo-anh-mau-style-bds.pdf",
                hint: "portfolio before/after: HDR, thay trời, day-to-dusk, virtual staging"
              }
            ]
          },
          {
            title: "Onboarding khách Mỹ mới: lập hồ sơ yêu cầu và style guide riêng",
            desc: `Khách Mỹ mới, chuyên virtual staging và chỉnh ảnh BĐS.

[x] Hồ sơ khách: múi giờ, kênh liên lạc, giờ nhận/trả đơn
[x] Style guide: tông màu, độ sáng, cách đặt tên file
[x] Tạo thư mục khách trên NAS
[ ] Hỏi trước phong cách nội thất ưa thích cho virtual staging`,
            priority: "normal",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 14,
            subtasks: [
              "Lập hồ sơ khách và khung giờ làm việc",
              "Viết style guide riêng cho khách",
              "Tạo thư mục khách trên NAS mới"
            ]
          },
          {
            title: "Tạo nhóm trao đổi và quy ước đặt tên file cho khách Nhật",
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Mới",
            due: "tomorrow",
            createdDaysAgo: 3
          },
          {
            title: "Gửi mẫu style day-to-dusk cho agency mới ở Queensland",
            priority: "normal",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Chờ khách phản hồi",
            due: "none",
            createdDaysAgo: 8
          },
          {
            title: "Checklist onboarding khách mới chuẩn hoá trên Nesso Work",
            desc: `Checklist dùng chung cho mọi khách mới:

[x] Thu thập yêu cầu và style guide
[x] Xác nhận múi giờ, deadline chuẩn
[x] Tạo thư mục trên NAS
[x] Tạo task trong project Chăm sóc khách hàng
[x] Gửi bộ ảnh mẫu style`,
            priority: "low",
            creator: "linh",
            assignees: ["acc1", "linh"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 40
          },
          {
            title: "Test 5 ảnh xoá vật thể cho khách Canada – khách không phản hồi",
            priority: "low",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Đóng",
            due: "past",
            createdDaysAgo: 30
          },
          {
            title: "Chuẩn bị báo cáo kết quả test khách Nhật cho anh giám đốc",
            priority: "high",
            creator: "linh",
            assignees: ["acc1"],
            status: "Mới",
            due: "next_week",
            createdDaysAgo: 1
          },
          {
            title: "Hướng dẫn khách mới dùng link upload ảnh thay vì gửi qua chat",
            priority: "normal",
            creator: "acc1",
            assignees: [],
            status: "Đang xử lý",
            due: "none",
            createdDaysAgo: 10
          },
          {
            title: "Lên lịch họp online giới thiệu quy trình với khách Nhật",
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1", "linh"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 7,
            comments: [
              {
                by: "acc1",
                at: 0.3,
                text: "Khách chọn 9h sáng thứ 2 giờ VN (bên Nhật là 11h).",
                replies: [
                  {
                    by: "linh",
                    at: 0.4,
                    text: "Ok, chị chuẩn bị slide quy trình. @{khoa} tham gia phần QC nhé."
                  },
                  { by: "khoa", at: 0.5, text: "Dạ anh vào được." }
                ]
              }
            ]
          }
        ]
      },

      // ---------------------------------------------------------------- Báo giá & hợp đồng
      {
        name: "Báo giá & hợp đồng",
        description:
          "Báo giá, hợp đồng năm, phụ lục và điều khoản. Không ghi giá cụ thể trong task – xem file trên NAS.",
        color: "violet",
        tasks: [
          {
            title: "Gửi báo giá gói HDR kèm thay trời cho agency Brisbane nhóm 2",
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 33
          },
          {
            title: "Gia hạn hợp đồng năm với agency Sydney nhóm 1 – ký phụ lục",
            desc: `Hợp đồng năm với agency Sydney nhóm 1 hết hạn 31/10. Khách đồng ý gia hạn thêm 12 tháng, có điều chỉnh:

- Thêm cam kết thời gian giao 12h cho đơn gấp
- Bổ sung điều khoản bảo mật dữ liệu ảnh
- Giữ nguyên chính sách làm lại miễn phí

[x] Soạn phụ lục
[x] Gửi khách đọc trước
[ ] @{boss} ký phụ lục
[ ] Gửi bản scan cho khách`,
            priority: "high",
            creator: "acc1",
            assignees: ["boss", "acc1"],
            status: "Đang xử lý",
            due: "overdue",
            createdDaysAgo: 9,
            files: [
              {
                name: "phu-luc-gia-han-hop-dong-2027.docx",
                hint: "phụ lục gia hạn hợp đồng năm, bảng các điều khoản sửa đổi"
              }
            ],
            comments: [
              {
                by: "acc1",
                at: 0.2,
                text: "@{boss} phụ lục em để trong task, anh xem giúp mục 3 về thời gian giao 12h ạ.",
                replies: [
                  {
                    by: "boss",
                    at: 1.5,
                    text: "Mục 3 ok. Nhưng đơn gấp 12h chỉ áp dụng tối đa 50 ảnh/đơn, thêm câu đó vào."
                  },
                  { by: "acc1", at: 1.6, text: "Dạ em sửa rồi ạ, bản mới đã cập nhật trong task." }
                ]
              },
              {
                by: "linh",
                at: 6.0,
                text: "Task này trễ rồi, khách bên kia có hỏi chưa em?",
                replies: [
                  { by: "acc1", at: 6.1, text: "Dạ khách nhắc nhẹ hôm qua ạ. Giờ chỉ còn chờ anh ký thôi." }
                ]
              },
              {
                by: "acc1",
                at: 8.6,
                text: "@{boss} anh ơi tuần sau khách đi công tác, em gửi bản scan trong thứ 2 được không ạ? 🙏"
              }
            ]
          },
          {
            title: "Bổ sung điều khoản bảo mật dữ liệu ảnh vào hợp đồng mẫu",
            desc: `Nhiều khách hỏi về bảo mật ảnh (ảnh nhà riêng, ảnh sản phẩm chưa ra mắt). Cần bổ sung:
- Không dùng ảnh khách làm portfolio nếu chưa có đồng ý bằng văn bản
- Xoá dữ liệu gốc sau 90 ngày kể từ ngày giao
- Nhân viên ký cam kết bảo mật (theo chính sách nội bộ)

Tham khảo: [mẫu điều khoản bảo mật](https://example.com/templates/data-confidentiality)`,
            priority: "high",
            creator: "linh",
            assignees: ["acc1", "linh"],
            status: "Đang xử lý",
            due: "week",
            createdDaysAgo: 11,
            subtasks: [
              { title: "Soạn điều khoản bảo mật bản tiếng Anh", assignees: ["acc1"], status: "Đang xử lý" },
              {
                title: "Đối chiếu với chính sách bảo mật nội bộ của ban điều hành",
                assignees: ["linh"],
                status: "Mới"
              }
            ],
            comments: [
              {
                by: "acc1",
                at: 2.0,
                text: "Khách Nhật cũng hỏi điều này, chắc phải làm thêm bản tiếng Nhật đơn giản.",
                replies: [{ by: "linh", at: 2.2, text: "Trước mắt làm bản tiếng Anh, tiếng Nhật tính sau nhé." }]
              },
              {
                by: "linh",
                at: 9.5,
                text: "Chính sách nội bộ đang chờ anh giám đốc duyệt, duyệt xong chị đối chiếu luôn."
              }
            ]
          },
          {
            title: "Báo giá dịch vụ virtual staging theo số phòng cho khách Mỹ mới",
            priority: "normal",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 16
          },
          {
            title: "Rà soát điều khoản thời gian giao 12h/24h trong hợp đồng",
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Mới",
            due: "none",
            createdDaysAgo: 8
          },
          {
            title: "Báo giá cắt nền sản phẩm số lượng lớn cho khách Nhật (sau test)",
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1", "acc2"],
            status: "Mới",
            due: "later",
            createdDaysAgo: 2,
            comments: [
              {
                by: "boss",
                at: 0.5,
                text: "Chưa gửi giá vội, đợi bản sửa 4 ảnh được duyệt rồi mình họp nội bộ chốt phương án.",
                replies: [{ by: "acc1", at: 0.6, text: "Dạ em giữ lại ạ." }]
              }
            ]
          },
          {
            title: "Cập nhật bảng giá 2027 theo định hướng ban giám đốc",
            priority: "normal",
            creator: "linh",
            assignees: ["acc1"],
            status: "Mới",
            due: "none",
            createdDaysAgo: 4
          },
          {
            title: "Xác nhận điều khoản làm lại miễn phí với agency Melbourne nhóm 3",
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Chờ khách phản hồi",
            due: "overdue",
            createdDaysAgo: 10
          },
          {
            title: "Lưu trữ hợp đồng đã ký lên thư mục chung trên NAS mới",
            priority: "low",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 17,
            comments: [
              {
                by: "acc2",
                at: 0.5,
                text: "Thư mục `HopDong/2026` trên NAS mới chưa có quyền ghi cho bên account. @{minh} anh mở giúp em với ạ.",
                replies: [
                  { by: "minh", at: 0.7, text: "Anh mở quyền rồi, em thử lại nhé." },
                  { by: "acc2", at: 0.8, text: "Được rồi ạ, cảm ơn anh." }
                ]
              }
            ]
          },
          {
            title: "Báo giá retouch ảnh cưới cho studio ở Úc",
            priority: "low",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Đóng",
            due: "past",
            createdDaysAgo: 28
          }
        ]
      },

      // ---------------------------------------------------------------- Khảo sát & chăm sóc định kỳ
      {
        name: "Khảo sát & chăm sóc định kỳ",
        description: "Khảo sát hài lòng, gọi chăm sóc khách lâu không đặt đơn, tri ân khách thân thiết.",
        color: "teal",
        tasks: [
          {
            title: "Khảo sát hài lòng khách hàng quý 3",
            desc: `Gửi khảo sát cho toàn bộ khách có đơn trong quý 3.

- Hình thức: form online, 8 câu, tiếng Anh
- Link form: [khảo sát Q3](https://example.com/forms/csat-q3)
- Hạn khách trả lời: 05/10

@{an} làm giúp phần giao diện email cho đẹp nhé.`,
            priority: "high",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 15,
            files: [{ name: "khao-sat-hai-long-q3.pdf", hint: "bản in form khảo sát 8 câu và thư mời khách" }],
            comments: [
              {
                by: "acc1",
                at: 0.5,
                text: "Mẫu email An làm xong rồi, dùng màu thương hiệu mới. @{acc2} gửi khách chiều nay nhé.",
                replies: [{ by: "acc2", at: 0.6, text: "Ok, 15h mình gửi một lượt." }]
              },
              {
                by: "boss",
                at: 1.0,
                text: "Thêm 1 câu hỏi mở: khách muốn mình cải thiện điều gì nhất. Anh muốn đọc nguyên văn.",
                replies: [{ by: "acc1", at: 1.1, text: "Dạ em thêm rồi ạ." }]
              },
              { by: "acc1", at: 10.2, text: "Đã nhận 21 phản hồi, chốt khảo sát." }
            ]
          },
          {
            title: "Tổng hợp kết quả khảo sát quý 3 và đề xuất cải tiến",
            desc: `Tổng hợp 21 phản hồi khảo sát quý 3:
- Điểm hài lòng trung bình: 4,3/5
- Khen: thái độ phục vụ, phản hồi nhanh
- Chê: màu trời không đồng đều giữa các đơn, giao trễ mùa cao điểm

Đề xuất: mỗi khách lớn có 1 preset màu riêng, QC đối chiếu preset trước khi giao.`,
            priority: "high",
            creator: "acc1",
            assignees: ["acc1", "khoa"],
            status: "Đang xử lý",
            due: "overdue",
            createdDaysAgo: 8,
            comments: [
              {
                by: "khoa",
                at: 2.0,
                text: "Ý preset riêng cho từng khách anh thấy khả thi, nhưng cần đặt tên preset thống nhất.",
                edited:
                  "Ý preset riêng cho từng khách anh thấy khả thi, nhưng cần đặt tên preset thống nhất, ví dụ `KH-nhom-v1`."
              },
              {
                by: "boss",
                at: 4.0,
                text: "Báo cáo này anh cần trước giao ban thứ 2. Có số liệu so với quý 2 không?",
                replies: [
                  {
                    by: "acc1",
                    at: 4.1,
                    text: "Dạ quý 2 mình chưa làm khảo sát nên chưa có số so sánh ạ, em sẽ ghi chú trong báo cáo."
                  },
                  { by: "boss", at: 4.2, text: "Ok, từ quý 4 làm đều mỗi quý." }
                ]
              },
              {
                by: "linh",
                at: 7.5,
                text: "Anh giám đốc đang chờ báo cáo này đó em, tối nay gửi chị bản nháp nhé.",
                replies: [{ by: "acc1", at: 7.6, text: "Dạ 9h tối em gửi chị ạ." }]
              }
            ]
          },
          {
            title: "Gọi chăm sóc 8 khách lâu không đặt đơn (trên 60 ngày)",
            desc: `Danh sách khách không đặt đơn trên 60 ngày:

[x] agency Perth nhóm 4
[x] studio ảnh cưới ở New Zealand
[ ] agency Brisbane nhóm 5
[ ] khách Mỹ cũ (đơn chân dung)
[ ] agency Gold Coast nhóm 1
[ ] 3 khách lẻ ở Canada

Ghi lại lý do khách ngừng đặt đơn vào bình luận.`,
            priority: "normal",
            creator: "acc1",
            assignees: ["acc2"],
            status: "Đang xử lý",
            due: "week",
            createdDaysAgo: 5,
            subtasks: [
              { title: "Gọi nhóm khách Úc (4 khách)", assignees: ["acc2"], status: "Đang xử lý" },
              { title: "Gửi email hỏi thăm 3 khách lẻ ở Canada", assignees: ["acc2"], status: "Mới" },
              { title: "Tổng hợp lý do khách ngừng đặt đơn", assignees: ["acc1"], status: "Mới" }
            ],
            comments: [
              {
                by: "acc2",
                at: 1.0,
                text: "agency Perth nhóm 4: chuyển sang dùng freelancer rẻ hơn, nhưng than chất lượng không ổn định. Có khả năng quay lại."
              },
              {
                by: "acc2",
                at: 2.5,
                text: "Studio New Zealand đang mùa thấp điểm, hẹn tháng 11 sẽ có đơn cưới.",
                replies: [{ by: "linh", at: 2.6, text: "Tốt, nhớ đặt nhắc đầu tháng 11 gọi lại nhé." }]
              }
            ]
          },
          {
            title: "Gửi thư cảm ơn khách thân thiết dịp cuối quý",
            priority: "low",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 11
          },
          {
            title: "Lập lịch check-in hàng tháng với 5 khách lớn",
            priority: "normal",
            creator: "linh",
            assignees: [],
            status: "Mới",
            due: "none",
            createdDaysAgo: 3
          },
          {
            title: "Theo dõi tỷ lệ đơn bị yêu cầu làm lại theo từng khách",
            desc: `Mục tiêu quý 4: tỷ lệ ảnh phải làm lại **dưới 3%** trên tổng số ảnh giao.

- Nguồn số liệu: task trong list Phản hồi & khiếu nại + báo cáo QC
- Cập nhật mỗi thứ 6`,
            priority: "normal",
            creator: "khoa",
            assignees: ["khoa", "acc1"],
            status: "Đang xử lý",
            due: "none",
            createdDaysAgo: 12
          },
          {
            title: "Chuẩn bị quà và thiệp tri ân khách dịp cuối năm",
            priority: "low",
            creator: "acc2",
            assignees: ["acc2"],
            status: "Mới",
            due: "later",
            createdDaysAgo: 1
          },
          {
            title: "Gọi hỏi thăm agency Melbourne nhóm 3 sau đợt làm lại",
            priority: "normal",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Đã giải quyết",
            due: "past",
            createdDaysAgo: 12,
            comments: [
              {
                by: "acc1",
                at: 0.4,
                text: "Khách hài lòng với bản sửa, vừa gửi thêm đơn 90 ảnh 😊",
                replies: [
                  {
                    by: "boss",
                    at: 0.5,
                    text: "Tốt lắm. Đơn này giao sớm hơn hạn để khách thấy mình đã cải thiện."
                  }
                ]
              }
            ]
          },
          {
            title: "Khảo sát thử – form cũ (không dùng nữa)",
            priority: "low",
            creator: "acc1",
            assignees: [],
            status: "Mới",
            due: "none",
            createdDaysAgo: 19,
            trash: true
          }
        ]
      }
    ]
  },

  // ==========================================================================================
  // BDH — Ban điều hành (private)
  // ==========================================================================================
  {
    key: "BDH",
    name: "Ban điều hành",
    description:
      "Không gian riêng của ban điều hành: kế hoạch quý, biên bản giao ban hằng tuần, chính sách và quy chế nội bộ. Không chia sẻ nội dung ra ngoài.",
    icon: "shield",
    color: "slate",
    visibility: "private",
    owner: "boss",
    createdOn: "2026-08-25",
    members: {
      boss: "manage",
      linh: "manage",
      admin: "manage",
      acc1: "submit",
      lead1: "submit",
      lead2: "view"
    },
    workflow: [
      { name: "Cần làm", category: "active", color: "slate" },
      { name: "Đang làm", category: "active", color: "blue" },
      { name: "Chờ duyệt", category: "active", color: "amber" },
      { name: "Xong", category: "done", color: "green" }
    ],
    lists: [
      // ---------------------------------------------------------------- Kế hoạch quý 4
      {
        name: "Kế hoạch quý 4",
        description: "Mục tiêu và các dự án lớn của quý 4/2026.",
        color: "blue",
        tasks: [
          {
            title: "Chốt mục tiêu sản lượng quý 4 theo từng nhóm sản xuất",
            desc: `Căn cứ sản lượng quý 3 và kế hoạch tuyển thêm 6 retoucher.

## Mục tiêu đề xuất
- Tổng sản lượng quý 4: **tăng 15%** so với quý 3
- Nhóm A: tăng 12% (giữ ổn định khách Úc)
- Nhóm B: tăng 18% (nhận thêm khách Mỹ, khách Nhật)
- Tỷ lệ làm lại: dưới 3%

[x] Lấy số liệu quý 3 từ báo cáo sản xuất
[x] Trưởng ca góp ý
[x] Anh giám đốc chốt
[x] Công bố tại kickoff 05/10`,
            priority: "high",
            creator: "boss",
            assignees: ["boss", "linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 14,
            comments: [
              {
                by: "linh",
                at: 1.0,
                text: "Em gửi anh số liệu quý 3 tạm tính đến 25/9: nhóm A đạt 104% kế hoạch, nhóm B 97% do thiếu người giữa tháng 9.",
                replies: [
                  { by: "boss", at: 1.2, text: "Nhóm B tăng 18% có cao quá không? @{lead1} thấy sao?" },
                  {
                    by: "lead1",
                    at: 1.3,
                    text: "Dạ nếu có 3 bạn mới vào nhóm B từ giữa tháng 10 thì làm được ạ, nhưng tháng đầu sẽ chậm."
                  },
                  { by: "boss", at: 1.5, text: "Ok giữ 18%, nhưng sản lượng người mới tính từ tháng 11." }
                ]
              },
              { by: "boss", at: 7.2, text: "Chốt. Linh công bố tại kickoff thứ 2 nhé." }
            ]
          },
          {
            title: "Phương án mở rộng ca đêm cho khách Úc/Mỹ từ tháng 11",
            desc: `Đợt cao điểm 14–19/9 cho thấy ca đêm đang thiếu người và không có QC.

- Hiện tại: ca đêm 4 người, không có QC riêng
- Đề xuất: tăng lên 8 người, có 1 QC, luân phiên theo tuần
- Cần làm rõ: phụ cấp ca đêm, hỗ trợ đi lại, an ninh toà nhà sau 22h

@{lead1} lập danh sách bạn tự nguyện, @{admin} hỏi ban quản lý toà nhà về giờ ra vào.`,
            priority: "high",
            creator: "boss",
            assignees: ["linh", "lead1"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 10,
            subtasks: [
              { title: "Khảo sát nhân viên muốn chuyển ca đêm", assignees: ["lead1"], status: "Xong" },
              {
                title: "Làm việc với ban quản lý toà nhà về giờ ra vào sau 22h",
                assignees: ["admin"],
                status: "Đang làm"
              },
              { title: "Dự trù phụ cấp ca đêm trình anh giám đốc", assignees: ["linh"], status: "Cần làm" }
            ],
            comments: [
              {
                by: "lead1",
                at: 3.0,
                text: "Khảo sát xong: 7 bạn đăng ký, trong đó 2 bạn chỉ làm được 2 tuần/tháng.",
                replies: [
                  {
                    by: "linh",
                    at: 3.2,
                    text: "Đủ để chạy luân phiên rồi. Còn thiếu 1 QC, chị sẽ trao đổi với anh Khoa."
                  }
                ]
              },
              {
                by: "admin",
                at: 5.0,
                text: "Ban quản lý toà nhà đồng ý cho ra vào sau 22h nếu đăng ký danh sách trước, mỗi tháng cập nhật 1 lần ạ.",
                replies: [{ by: "boss", at: 5.3, text: "Tốt. Thêm khoản hỗ trợ ăn khuya vào phương án nhé." }]
              },
              {
                by: "boss",
                at: 9.0,
                text: "@{linh} thứ 2 trình anh phương án hoàn chỉnh kèm chi phí dự kiến nhé."
              }
            ]
          },
          {
            title: "Khảo sát và chốt phương án thuê thêm mặt bằng tầng 3",
            desc: `Tầng 3 cùng toà nhà còn trống khoảng 120m², đủ cho 20–25 chỗ ngồi.

- Ưu điểm: không phải chuyển địa điểm, dùng chung hạ tầng mạng và NAS
- Nhược điểm: phải đi dây mạng, lắp thêm điều hoà
- Cần quyết định trước 31/10 để kịp bố trí chỗ cho đợt tuyển dụng

[x] Đi xem mặt bằng
[x] Lấy báo giá cải tạo
[ ] Anh giám đốc duyệt phương án`,
            priority: "normal",
            creator: "boss",
            assignees: ["admin", "linh"],
            status: "Chờ duyệt",
            due: "next_week",
            createdDaysAgo: 21,
            files: [
              { name: "phuong-an-mat-bang-tang-3.pdf", hint: "sơ đồ mặt bằng tầng 3, bố trí 22 chỗ ngồi và 1 phòng họp" }
            ],
            comments: [
              {
                by: "admin",
                at: 4.0,
                text: "Em đi xem rồi ạ, mặt bằng sạch, có sẵn 2 cục điều hoà cũ nhưng nên thay. Sơ đồ em đính kèm task.",
                replies: [
                  {
                    by: "boss",
                    at: 4.5,
                    text: "Bố trí thêm 1 phòng họp nhỏ được không? Giờ họp khách online toàn phải mượn phòng giám đốc."
                  },
                  {
                    by: "admin",
                    at: 4.6,
                    text: "Dạ được ạ, em chỉnh sơ đồ còn 22 chỗ + 1 phòng họp 6 người."
                  }
                ]
              },
              {
                by: "linh",
                at: 14.0,
                text: "Phương án đã cập nhật, đang chờ anh duyệt ạ. Khoản này liên quan ngân sách 2027 nên em đưa vào dự toán luôn."
              }
            ]
          },
          {
            title: "Kế hoạch tuyển 6 retoucher đợt tháng 10",
            desc: `Tuyển 6 retoucher (4 cho nhóm B, 2 cho ca đêm).

- Kênh: fanpage, các nhóm Photoshop, trường cao đẳng nghề
- Bài test: 3 ảnh HDR + 1 ảnh cắt nền
- Đào tạo: 2 tuần kèm trưởng ca, sau đó làm đơn thật có QC kèm`,
            priority: "high",
            creator: "linh",
            assignees: ["admin", "lead1"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 8,
            subtasks: [
              { title: "Đăng tin tuyển dụng trên fanpage và các nhóm", assignees: ["admin"], status: "Xong" },
              { title: "Chuẩn bị bài test tay nghề HDR + cắt nền", assignees: ["lead1"], status: "Xong" },
              { title: "Xếp lịch phỏng vấn tuần 12–16/10", assignees: ["admin"], status: "Đang làm" }
            ],
            comments: [
              {
                by: "admin",
                at: 2.2,
                text: "Đã có 23 hồ sơ sau 2 ngày đăng tin, em lọc còn 11 bạn mời làm bài test ạ.",
                replies: [{ by: "boss", at: 2.4, text: "Nhanh đấy 👍 Ưu tiên bạn nào đã làm ảnh BĐS rồi." }]
              },
              {
                by: "lead1",
                at: 6.5,
                text: "Đã chấm 7 bài test, 4 bạn đạt. Danh sách em gửi @{admin} xếp lịch phỏng vấn rồi."
              }
            ]
          },
          {
            title: "Lộ trình triển khai QC checklist v2 toàn xưởng",
            priority: "normal",
            creator: "boss",
            assignees: ["linh", "lead1"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 18
          },
          {
            title: "Mục tiêu khách mới quý 4 cho bộ phận account",
            priority: "normal",
            creator: "boss",
            assignees: ["acc1"],
            status: "Cần làm",
            due: "next_week",
            createdDaysAgo: 5
          },
          {
            title: "Kế hoạch tổ chức 20/10 cho chị em toàn công ty",
            priority: "low",
            creator: "boss",
            assignees: ["admin"],
            status: "Cần làm",
            due: "week",
            createdDaysAgo: 3,
            subtasks: [
              { title: "Đặt hoa và quà cho chị em", assignees: ["admin"] },
              { title: "Đặt bánh và trà chiều 16h ngày 20/10", assignees: ["admin"] }
            ]
          }
        ]
      },

      // ---------------------------------------------------------------- Họp giao ban
      {
        name: "Họp giao ban",
        description: "Biên bản họp giao ban sáng thứ 2 hằng tuần. Mỗi buổi một task, quyết định ghi dạng checklist.",
        color: "amber",
        tasks: [
          {
            title: "Biên bản giao ban tuần 36 (31/08)",
            desc: `Thành phần: anh giám đốc, chị Linh, @{admin}, @{acc1}, @{lead1}.

## Quyết định
[x] Toàn công ty chuyển sang Nesso Work từ 25/8, ngừng giao việc qua nhóm chat cũ
[x] Lịch trực lễ 2/9: mỗi nhóm cử 2 người, hưởng lương lễ theo quy định
[x] Account cập nhật trạng thái đơn trên task, không báo riêng qua tin nhắn`,
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 40
          },
          {
            title: "Biên bản giao ban tuần 37 (07/09)",
            desc: `## Quyết định
[x] Chốt lịch team building Vũng Tàu 26–27/9
[x] Tổ chức chia tay Lộc chiều thứ 6 11/9
[x] Chuẩn bị nhân sự cho mùa cao điểm khách Úc từ giữa tháng 9
[ ] Đánh giá lại hiệu suất máy trạm cũ (dời sang tuần sau)`,
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 33
          },
          {
            title: "Biên bản giao ban tuần 38 (14/09) – họp gấp đợt cao điểm",
            desc: `Họp gấp đầu tuần vì đơn từ khách Úc tăng gấp đôi.

## Quyết định
[x] Mở ca đêm từ 14/9 đến hết 19/9
[x] Tạm dừng nghỉ phép không gấp trong tuần
[x] QC ưu tiên soát trời và cửa sổ cho khách Úc
[x] Account báo khách thời gian giao dự kiến dài hơn 4 tiếng

@{boss} nhắc: chất lượng trước, sản lượng sau.`,
            priority: "urgent",
            creator: "linh",
            assignees: ["linh", "lead1"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 26,
            comments: [
              {
                by: "boss",
                at: 0.3,
                text: "Ai làm thêm giờ tuần này ghi nhận đầy đủ, cuối tháng anh duyệt bồi dưỡng riêng.",
                replies: [
                  { by: "admin", at: 0.4, text: "Dạ em theo dõi bảng chấm công làm thêm từng ngày ạ." }
                ]
              },
              {
                by: "lead1",
                at: 3.0,
                text: "Ca đêm hôm qua xong 420 ảnh, nhưng có 2 đơn bị khách phản hồi màu trời. Đã chuyển bên CSKH xử lý."
              }
            ]
          },
          {
            title: "Biên bản giao ban tuần 39 (21/09)",
            desc: `## Quyết định
[x] Tổng kết đợt cao điểm: sản lượng tăng mạnh nhưng khiếu nại cũng tăng
[x] Xử lý dứt điểm lỗi phân quyền thư mục sau khi chuyển NAS mới
[x] @{admin} gửi bản nháp chính sách làm thêm giờ và phụ cấp ca đêm trong tuần
[x] Chuẩn bị Trung thu 25/9: bánh cho toàn bộ nhân viên`,
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 19
          },
          {
            title: "Biên bản giao ban tuần 40 (28/09) – chốt quý 3",
            desc: `## Quyết định
[x] Báo cáo quý 3 nộp trước 30/9
[x] Bắt đầu lập ngân sách 2027 (project riêng, chỉ ban giám đốc)
[x] Chốt kickoff quý 4 vào thứ 2 05/10
[x] Tuyển 6 retoucher trong tháng 10

Biên bản đầy đủ đính kèm.`,
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 12,
            files: [
              {
                name: "bien-ban-hop-giao-ban-tuan-40.docx",
                hint: "biên bản họp giao ban tuần 40, danh sách quyết định và người phụ trách"
              }
            ],
            comments: [
              {
                by: "boss",
                at: 0.5,
                text: "Biên bản ok. Lần sau ghi rõ hạn chót cho từng quyết định nhé.",
                edited: "Biên bản ok. Lần sau ghi rõ người phụ trách và hạn chót cho từng quyết định nhé.",
                replies: [{ by: "admin", at: 0.6, text: "Dạ em rút kinh nghiệm ạ." }]
              }
            ]
          },
          {
            title: "Biên bản giao ban tuần 41 (05/10) – kickoff quý 4",
            desc: `Kickoff quý 4, mời thêm trưởng ca nhóm B dự họp.

## Quyết định
[x] Công bố mục tiêu sản lượng quý 4 (phụ trách: chị Linh)
[x] Áp dụng QC checklist v2 từ hôm nay (phụ trách: trưởng nhóm QC)
[ ] Ưu tiên khách Nhật dùng thử, báo cáo kết quả trong tuần sau (@{acc1})
[ ] Chốt quy chế thưởng KPI quý 4 trước 08/10 (@{boss}, chị Linh)
[ ] Lịch phỏng vấn tuyển dụng tuần 12–16/10 (@{admin})`,
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 5,
            comments: [
              {
                by: "admin",
                at: 0.4,
                text: "@{boss} biên bản em gửi anh duyệt ạ, đã ghi người phụ trách và hạn cho từng mục như anh dặn.",
                replies: [
                  {
                    by: "boss",
                    at: 2.0,
                    text: "Mục KPI là anh đang trễ, đầu tuần sau anh chốt. Biên bản cứ để nguyên hạn cũ cho anh nhớ 😅"
                  },
                  { by: "admin", at: 2.1, text: "Dạ vâng ạ." }
                ]
              },
              {
                by: "linh",
                at: 4.8,
                text: "@{boss} anh duyệt giúp em biên bản này để em gửi các trưởng bộ phận ạ."
              }
            ]
          },
          {
            title: "Chuẩn bị nội dung giao ban tuần 42 (12/10)",
            desc: `Dự kiến nội dung:
1. Kết quả test khách Nhật (@{acc1})
2. Tiến độ tuyển dụng 6 retoucher (@{admin})
3. Phương án ca đêm từ tháng 11 (chị Linh)
4. Quy chế thưởng KPI quý 4 – chốt
5. Ngân sách 2027: rà soát vòng 1`,
            priority: "normal",
            creator: "boss",
            assignees: ["admin", "linh"],
            status: "Cần làm",
            due: "tomorrow",
            createdDaysAgo: 1,
            comments: [
              {
                by: "lead1",
                at: 0.6,
                text: "Em xin thêm 1 mục: lịch nghỉ bù cho các bạn làm thêm giờ tháng 9 ạ.",
                replies: [{ by: "linh", at: 0.7, text: "Ok em, chị thêm vào mục 6." }]
              }
            ]
          }
        ]
      },

      // ---------------------------------------------------------------- Chính sách & quy chế
      {
        name: "Chính sách & quy chế",
        description: "Soạn thảo, góp ý và ban hành chính sách, quy chế nội bộ.",
        color: "slate",
        tasks: [
          {
            title: "Chốt quy chế thưởng KPI quý 4",
            desc: `Quy chế thưởng KPI áp dụng cho khối sản xuất, QC và account từ quý 4.

## Tiêu chí (bản v2)
- Sản lượng đạt kế hoạch: 50%
- Tỷ lệ làm lại dưới 3%: 30%
- Đúng hạn và tuân thủ quy trình: 20%

## Mức thưởng
- Đạt 100–110%: hệ số 1,0
- Trên 110%: hệ số 1,2
- Dưới 90%: không thưởng

[x] Bản v1 lấy ý kiến trưởng ca
[x] Bản v2 sửa theo góp ý
[ ] @{boss} duyệt bản cuối
[ ] Công bố toàn công ty`,
            priority: "urgent",
            creator: "boss",
            assignees: ["boss", "linh"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 9,
            comments: [
              {
                by: "linh",
                at: 1.0,
                text: "Em gửi bản v2 đã sửa theo góp ý của trưởng ca ạ. Thay đổi chính: giảm trọng số sản lượng từ 60% xuống 50%.",
                files: [
                  { name: "quy-che-thuong-kpi-q4-v2.docx", hint: "quy chế thưởng KPI quý 4 bản v2, bảng tiêu chí và hệ số" }
                ],
                replies: [
                  {
                    by: "lead1",
                    at: 1.3,
                    text: "Bên sản xuất đồng ý bản v2 ạ. Có điều người đang thử việc có được tính không chị?"
                  },
                  { by: "linh", at: 1.4, text: "Người thử việc chưa tính, chị ghi chú thêm rồi." }
                ]
              },
              {
                by: "boss",
                at: 2.7,
                text: "Anh đọc rồi. Tiêu chí ok, nhưng hệ số 1,2 trên 110% dễ khiến các bạn chạy ẩu. Thêm điều kiện: tỷ lệ làm lại phải dưới 2% mới được hệ số 1,2.",
                replies: [
                  { by: "linh", at: 2.8, text: "Dạ hợp lý ạ, em sửa luôn." },
                  {
                    by: "acc1",
                    at: 2.9,
                    text: "Bên account tính đúng hạn theo hạn giao cho khách hay theo hạn nội bộ ạ?"
                  },
                  { by: "boss", at: 3.0, text: "Theo hạn giao khách." }
                ]
              },
              {
                by: "linh",
                at: 8.2,
                text: "@{boss} các bạn đang hỏi khi nào công bố quy chế KPI ạ 😅",
                replies: [
                  {
                    by: "boss",
                    at: 8.4,
                    text: "Anh xin lỗi, tuần này dồn việc quá. Thứ 2 giao ban anh chốt luôn, không dời nữa."
                  }
                ]
              }
            ]
          },
          {
            title: "Chính sách làm thêm giờ và phụ cấp ca đêm",
            desc: `Soạn chính sách sau đợt cao điểm tháng 9:
- Làm thêm ngày thường, ngày nghỉ, ngày lễ: tính theo đúng tỷ lệ luật lao động quy định
- Phụ cấp ca đêm cố định theo ca + hỗ trợ ăn khuya
- Làm thêm phải được trưởng ca duyệt trên Nesso Work trước khi làm`,
            priority: "high",
            creator: "boss",
            assignees: ["boss", "admin"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 22,
            subtasks: [
              "Đối chiếu quy định lao động hiện hành về làm thêm giờ",
              "Tạo mẫu đăng ký làm thêm giờ trên Nesso Work"
            ],
            comments: [
              {
                by: "admin",
                at: 5.0,
                text: "Em soạn xong bản nháp, anh xem giúp phần phụ cấp ca đêm ạ.",
                replies: [
                  {
                    by: "boss",
                    at: 8.0,
                    text: "Phụ cấp chia 2 mức: ca đêm thường và ca đêm kiêm QC. Em sửa rồi anh xem lại."
                  }
                ]
              },
              {
                by: "boss",
                at: 20.0,
                text: "Tuần sau chốt cùng phương án ca đêm tháng 11 cho đồng bộ."
              }
            ]
          },
          {
            title: "Chính sách bảo mật dữ liệu khách hàng (USB, cloud cá nhân, chụp màn hình)",
            desc: `Nhiều khách mới (đặc biệt khách Nhật) yêu cầu cam kết bảo mật. Nội dung chính:

- Cấm sao chép ảnh khách ra USB, cloud cá nhân, điện thoại
- Không chụp màn hình ảnh khách đăng lên mạng xã hội
- Dữ liệu gốc xoá sau 90 ngày kể từ ngày giao
- Toàn bộ nhân viên ký cam kết bảo mật

[x] Bản nháp
[x] Góp ý của account
[ ] @{boss} duyệt
[ ] Tổ chức ký cam kết`,
            priority: "high",
            creator: "admin",
            assignees: ["boss", "admin"],
            status: "Chờ duyệt",
            due: "today",
            createdDaysAgo: 16,
            comments: [
              {
                by: "acc1",
                at: 2.8,
                text: "Bên account đề nghị thêm: chỉ dùng ảnh làm portfolio khi khách xác nhận đồng ý bằng văn bản.",
                replies: [{ by: "admin", at: 3.0, text: "Đã thêm vào mục 5 ạ." }]
              },
              {
                by: "boss",
                at: 15.5,
                text: "Anh đọc gần xong, tối nay anh duyệt. Riêng mục xoá sau 90 ngày phải hỏi IT xem NAS có tự động được không.",
                replies: [{ by: "admin", at: 15.7, text: "Dạ em hỏi anh Minh ngay ạ." }]
              }
            ]
          },
          {
            title: "Quy định nghỉ phép và đăng ký đổi ca trên Nesso Work",
            priority: "normal",
            creator: "boss",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 38
          },
          {
            title: "Cập nhật nội quy văn phòng sau khi chuyển NAS mới",
            priority: "low",
            creator: "boss",
            assignees: [],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 17
          },
          {
            title: "Nháp quy chế thưởng KPI quý 4 (bản cũ, đã thay bằng v2)",
            priority: "low",
            creator: "linh",
            assignees: ["linh"],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 14,
            trash: true
          }
        ]
      }
    ]
  },

  // ==========================================================================================
  // NS — Ngân sách 2027 (private)
  // ==========================================================================================
  {
    key: "NS",
    name: "Ngân sách 2027",
    description:
      "Lập dự toán ngân sách năm 2027: chi phí vận hành, đầu tư thiết bị, nhân sự & lương thưởng. Số liệu chi tiết nằm trong file đính kèm, task chỉ ghi tỷ lệ và ghi chú.",
    icon: "chart",
    color: "emerald",
    visibility: "private",
    owner: "boss",
    createdOn: "2026-09-28",
    members: {
      boss: "manage",
      linh: "manage",
      admin: "submit",
      acc1: "submit",
      lead1: "view"
    },
    workflow: [
      { name: "Nháp", category: "active", color: "slate" },
      { name: "Đang rà soát", category: "active", color: "amber" },
      { name: "Đã chốt", category: "done", color: "green" }
    ],
    lists: [
      // ---------------------------------------------------------------- Dự toán chi phí vận hành
      {
        name: "Dự toán chi phí vận hành",
        description: "Điện, mạng, thuê văn phòng, phần mềm, lưu trữ dữ liệu, marketing.",
        color: "emerald",
        tasks: [
          {
            title: "Khung dự toán ngân sách 2027 và phân công người phụ trách",
            desc: `Ngân sách 2027 gồm 3 phần, mỗi phần một list:

1. Chi phí vận hành – @{admin}, @{acc1}
2. Đầu tư thiết bị – @{admin}
3. Nhân sự & lương thưởng – chị Linh

## Mốc thời gian
[x] 28/9: mở project, phân công
[ ] 16/10: xong bản nháp từng phần
[ ] 23/10: rà soát vòng 1 với anh giám đốc
[ ] 06/11: chốt ngân sách

Nguyên tắc: mọi con số để trong file Excel, task chỉ ghi tỷ lệ và ghi chú.`,
            priority: "high",
            creator: "boss",
            assignees: ["linh"],
            status: "Đã chốt",
            due: "past",
            createdDaysAgo: 12,
            subtasks: [
              { title: "Tạo file dự toán mẫu dùng chung", assignees: ["admin"], status: "Đã chốt" },
              { title: "Phân công người phụ trách từng phần", assignees: ["linh"], status: "Đã chốt" },
              { title: "Thu thập chi phí thực tế 9 tháng đầu năm 2026", assignees: ["acc1"], status: "Đã chốt" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.2,
                text: "Năm nay lập ngân sách sớm để có thời gian cân nhắc đầu tư máy. Project này chỉ ban giám đốc và người được giao xem, mọi người lưu ý không chia sẻ ra ngoài.",
                replies: [
                  { by: "linh", at: 0.3, text: "Dạ em phân công xong rồi ạ." },
                  {
                    by: "admin",
                    at: 0.4,
                    text: "Em tạo file mẫu trong thư mục riêng của ban giám đốc rồi ạ."
                  }
                ]
              }
            ]
          },
          {
            title: "Dự toán chi phí điện, internet và thuê văn phòng 2027",
            desc: `- Điện: dự kiến **tăng 12%** do mở rộng ca đêm và thêm máy trạm
- Internet: thêm 1 đường truyền dự phòng
- Thuê văn phòng: giả định thuê thêm tầng 3 từ tháng 1/2027 (chờ quyết định bên Ban điều hành)

File chi tiết đính kèm.`,
            priority: "normal",
            creator: "linh",
            assignees: ["admin"],
            status: "Đang rà soát",
            due: "next_week",
            createdDaysAgo: 10,
            files: [
              {
                name: "du-toan-chi-phi-2027-v1.xlsx",
                hint: "bảng dự toán chi phí vận hành 2027 theo tháng: điện, mạng, thuê mặt bằng"
              }
            ],
            comments: [
              {
                by: "linh",
                at: 2.0,
                text: "Phần điện em tính cả điều hoà tầng 3 chưa?",
                replies: [
                  { by: "admin", at: 2.1, text: "Dạ chưa ạ, em bổ sung 2 kịch bản: có và không có tầng 3." }
                ]
              },
              { by: "boss", at: 6.0, text: "Làm 2 kịch bản là đúng. Anh xem bản v2 trước 23/10 nhé." }
            ]
          },
          {
            title: "Dự toán bản quyền phần mềm chỉnh ảnh và plugin năm 2027",
            priority: "normal",
            creator: "linh",
            assignees: ["admin"],
            status: "Nháp",
            due: "next_week",
            createdDaysAgo: 9
          },
          {
            title: "Chi phí lưu trữ và sao lưu dữ liệu ảnh khách (NAS + cloud)",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Nháp",
            due: "later",
            createdDaysAgo: 8
          },
          {
            title: "So sánh chi phí vận hành 2026 thực tế với kế hoạch",
            desc: `Đối chiếu chi phí 9 tháng đầu năm với kế hoạch:
- Khoản vượt kế hoạch: làm thêm giờ (tháng 9), sửa chữa máy
- Khoản dưới kế hoạch: marketing, đào tạo

Ghi chú lý do cho từng khoản chênh lệch trên 10%.`,
            priority: "high",
            creator: "linh",
            assignees: ["acc1", "linh"],
            status: "Đang rà soát",
            due: "week",
            createdDaysAgo: 11,
            comments: [
              {
                by: "acc1",
                at: 3.0,
                text: "Chi phí làm thêm giờ tháng 9 vượt khoảng 35% so với kế hoạch tháng, chủ yếu do tuần cao điểm 14–19/9.",
                replies: [
                  {
                    by: "boss",
                    at: 3.5,
                    text: "Cái này dự kiến được mà. Năm sau tách riêng khoản dự phòng mùa cao điểm."
                  }
                ]
              },
              {
                by: "acc1",
                at: 10.5,
                text: "@{boss} em gửi bản so sánh đầy đủ rồi ạ, anh xem lúc nào tiện."
              }
            ]
          },
          {
            title: "Dự toán chi phí marketing và website năm 2027",
            priority: "low",
            creator: "linh",
            assignees: [],
            status: "Nháp",
            due: "later",
            createdDaysAgo: 6
          }
        ]
      },

      // ---------------------------------------------------------------- Đầu tư thiết bị
      {
        name: "Đầu tư thiết bị",
        description: "Máy trạm, màn hình chuẩn màu, hạ tầng phòng máy chủ.",
        color: "cyan",
        tasks: [
          {
            title: "Duyệt dự toán đầu tư 20 máy trạm",
            desc: `Đề xuất thay 20 máy trạm cũ (trên 5 năm, hay treo khi chạy HDR 5 bracket).

- Cấu hình đề xuất: CPU đời mới, RAM 64GB, SSD NVMe, card đồ hoạ tầm trung
- Chia 2 đợt: 10 máy trong quý 1, 10 máy trong quý 3/2027
- Máy cũ: 8 máy còn dùng được chuyển cho đào tạo, còn lại thanh lý

[x] Lấy 3 báo giá
[x] So sánh cấu hình
[ ] @{boss} duyệt`,
            priority: "high",
            creator: "linh",
            assignees: ["boss"],
            status: "Đang rà soát",
            due: "today",
            createdDaysAgo: 7,
            subtasks: [
              { title: "Lấy 3 báo giá từ nhà cung cấp", assignees: ["admin"], status: "Đã chốt" },
              { title: "Bảng so sánh cấu hình và hiệu năng", assignees: ["admin"], status: "Đã chốt" },
              { title: "Phương án thanh lý máy cũ", assignees: ["acc1"], status: "Nháp" }
            ],
            comments: [
              {
                by: "admin",
                at: 2.0,
                text: "Em đính kèm bảng so sánh 3 cấu hình ạ. Phương án B cân bằng nhất giữa giá và hiệu năng.",
                files: [
                  {
                    name: "so-sanh-cau-hinh-may-tram.xlsx",
                    hint: "so sánh 3 cấu hình máy trạm: CPU, RAM, GPU, thời gian blend HDR"
                  }
                ],
                replies: [
                  {
                    by: "boss",
                    at: 2.5,
                    text: "RAM 64GB có cần cho tất cả không, hay chỉ nhóm làm HDR?"
                  },
                  {
                    by: "admin",
                    at: 2.6,
                    text: "Dạ theo anh Minh thì nhóm cắt nền dùng 32GB là đủ, em tách thành 2 cấu hình ạ."
                  }
                ]
              },
              {
                by: "linh",
                at: 5.0,
                text: "Em đề xuất đợt 1 tăng lên 12 máy để kịp cho 6 bạn mới vào tháng 10–11."
              },
              {
                by: "boss",
                at: 6.6,
                text: "Đồng ý chia 2 cấu hình. Số lượng đợt 1 để anh cân nhắc thêm, tối nay anh trả lời."
              }
            ]
          },
          {
            title: "Thay 15 màn hình chuẩn màu cho nhóm QC và trưởng ca",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Nháp",
            due: "next_week",
            createdDaysAgo: 6
          },
          {
            title: "Nâng cấp UPS và điều hoà phòng máy chủ",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Nháp",
            due: "later",
            createdDaysAgo: 5
          },
          {
            title: "Đánh giá mua thêm 1 NAS dự phòng sau đợt chuyển NAS tháng 9",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Đã chốt",
            due: "past",
            createdDaysAgo: 9
          },
          {
            title: "Lịch khấu hao thiết bị cũ và phương án thanh lý máy",
            priority: "low",
            creator: "acc1",
            assignees: ["acc1"],
            status: "Nháp",
            due: "none",
            createdDaysAgo: 4
          }
        ]
      },

      // ---------------------------------------------------------------- Nhân sự & lương thưởng
      {
        name: "Nhân sự & lương thưởng",
        description: "Định biên, tăng lương, quỹ thưởng, tuyển dụng và đào tạo.",
        color: "violet",
        tasks: [
          {
            title: "Chốt tỷ lệ tăng lương 2027 cho khối sản xuất",
            desc: `Hai phương án:
- **Phương án A**: tăng đồng loạt 8%
- **Phương án B**: tăng 6% đồng loạt + thêm tối đa 6% theo đánh giá KPI cả năm

Lưu ý: so với mặt bằng ngành, lương retoucher có kinh nghiệm của mình đang thấp hơn khoảng 5–10%.`,
            priority: "high",
            creator: "linh",
            assignees: ["boss", "linh"],
            status: "Đang rà soát",
            due: "week",
            createdDaysAgo: 8,
            subtasks: [
              "Khảo sát mức lương retoucher trên thị trường",
              "Tính tác động của từng phương án lên tổng quỹ lương"
            ],
            comments: [
              {
                by: "linh",
                at: 1.0,
                text: "@{boss} em nghiêng về phương án B vì gắn với KPI, nhưng sợ các bạn mới vào thấy thiệt.",
                replies: [
                  {
                    by: "boss",
                    at: 1.5,
                    text: "Anh cũng thích B. Người làm dưới 1 năm thì tính KPI theo số tháng làm việc thực tế."
                  },
                  { by: "linh", at: 1.6, text: "Dạ em tính lại theo hướng đó ạ." }
                ]
              },
              {
                by: "admin",
                at: 4.0,
                text: "Đã có số liệu khảo sát lương thị trường, em gửi chị Linh qua file riêng ạ.",
                edited: "Đã có số liệu khảo sát lương thị trường từ 3 nguồn, em gửi chị Linh qua file riêng ạ."
              }
            ]
          },
          {
            title: "Dự toán quỹ thưởng Tết và thưởng KPI năm 2027",
            desc: `- Thưởng Tết: tối thiểu 1 tháng lương, cộng thêm theo thâm niên
- Thưởng KPI: theo quy chế quý (đang chờ chốt bên Ban điều hành)
- Dự phòng: 5% tổng quỹ thưởng`,
            priority: "high",
            creator: "boss",
            assignees: ["linh", "admin"],
            status: "Nháp",
            due: "next_week",
            createdDaysAgo: 5,
            subtasks: [
              "Tính quỹ thưởng Tết theo thâm niên",
              "Ước tính thưởng KPI 4 quý theo kế hoạch sản lượng"
            ],
            comments: [
              {
                by: "boss",
                at: 0.3,
                text: "Thưởng Tết năm nay giữ ít nhất bằng năm ngoái, kể cả khi quý 4 không đạt. Anh không muốn anh em phải lo.",
                replies: [{ by: "linh", at: 0.5, text: "Dạ em ghi nhận ạ." }]
              }
            ]
          },
          {
            title: "Dự toán chi phí tuyển dụng và đào tạo retoucher mới",
            priority: "normal",
            creator: "linh",
            assignees: ["admin"],
            status: "Đã chốt",
            due: "past",
            createdDaysAgo: 11
          },
          {
            title: "Định biên nhân sự 2027 theo kế hoạch sản lượng",
            priority: "normal",
            creator: "linh",
            assignees: ["linh"],
            status: "Nháp",
            due: "none",
            createdDaysAgo: 3
          }
        ]
      }
    ]
  }
];
