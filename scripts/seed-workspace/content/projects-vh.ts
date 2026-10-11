import type { ProjectSeed, StatusSeed } from "../types.js";

/**
 * VH — Vận hành studio (cơ sở vật chất, lịch ca, mua sắm, quy trình nội bộ)
 * CVP — Chuyển văn phòng tầng 5 (đã lưu trữ)
 * Toàn bộ nội dung là hư cấu.
 */

const opsWorkflow: StatusSeed[] = [
  { name: "Cần làm", category: "active", color: "slate" },
  { name: "Đang làm", category: "active", color: "blue" },
  { name: "Chờ duyệt", category: "active", color: "amber" },
  { name: "Xong", category: "done", color: "green" },
  { name: "Huỷ", category: "closed", color: "gray" }
];

export const projectsVh: ProjectSeed[] = [
  // ===================================================================================================
  // VH — Vận hành studio
  // ===================================================================================================
  {
    key: "VH",
    name: "Vận hành studio",
    description:
      "Theo dõi cơ sở vật chất, lịch ca sản xuất, mua sắm và quy trình nội bộ của studio. Sự cố văn phòng, đề xuất mua sắm, đổi ca… tạo task tại đây thay cho nhắn Zalo.",
    icon: "building",
    color: "blue",
    visibility: "public",
    owner: "linh",
    createdOn: "2026-08-25",
    members: {
      linh: "manage",
      boss: "manage",
      admin: "manage",
      lead1: "submit",
      lead2: "submit",
      khoa: "submit",
      minh: "submit",
      acc1: "submit",
      nv03: "submit",
      nv05: "submit",
      nv07: "submit",
      nv09: "submit",
      nv12: "submit"
    },
    workflow: opsWorkflow,
    lists: [
      // ---------------------------------------------------------------------------------------------
      {
        name: "Cơ sở vật chất & thiết bị",
        description: "Máy trạm, màn hình, bút vẽ, điều hoà, điện, UPS, bàn ghế.",
        color: "blue",
        tasks: [
          {
            title: "Calibrate lại 12 màn hình phòng retouch tầng 2",
            desc:
              "Khách Nhật làm thử bên cut-out sản phẩm rất khắt khe về nền trắng và màu sản phẩm, nên cần calibrate lại toàn bộ màn dãy A/B trước khi chạy đơn thật.\n\n" +
              "Thông số chuẩn:\n" +
              "- Điểm trắng `D65`, gamma `2.2`, độ sáng 120 cd/m²\n" +
              "- Lưu profile theo tên máy, ví dụ `A04_2026-10`\n\n" +
              "[x] Mượn máy đo màu của phòng QC\n" +
              "[ ] Calibrate dãy A\n" +
              "[ ] Calibrate dãy B\n" +
              "[ ] Cập nhật bảng thông số lên thư mục chung",
            priority: "high",
            creator: "khoa",
            assignees: ["khoa", "nv03", "nv08"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 6,
            subtasks: [
              { title: "Calibrate dãy A (6 màn)", assignees: ["nv03"], status: "Xong" },
              { title: "Calibrate dãy B (6 màn)", assignees: ["nv08"], status: "Đang làm" },
              { title: "Cập nhật bảng thông số sau calibrate", assignees: ["khoa"], status: "Cần làm" }
            ],
            comments: [
              {
                by: "nv03",
                at: 1.3,
                text: "Dãy A xong 6/6 rồi ạ. Màn A04 lệch gamma khá nhiều, calibrate 2 lần mới đạt.",
                files: [{ name: "Ảnh báo cáo calibrate màn A04.png", hint: "màn hình phần mềm calibrate báo kết quả delta E sau khi hiệu chỉnh" }],
                replies: [
                  { by: "khoa", at: 1.5, text: "Ok em, màn A04 ghi chú lại, tháng sau đo lại xem có xuống cấp không nhé." }
                ]
              },
              {
                by: "nv08",
                at: 3.2,
                text: "Dãy B em làm được 3 màn, máy đo đang bị nhóm A mượn nên mai em làm tiếp ạ."
              },
              {
                by: "khoa",
                at: 4.5,
                text: "@{lead2} sắp xếp giúp anh 30 phút đầu ca chiều mai để @{nv08} làm nốt dãy B nhé.",
                replies: [{ by: "lead2", at: 4.6, text: "Dạ ok anh, em cho bạn ấy làm từ 13h30." }]
              }
            ]
          },
          {
            title: "Sửa điều hoà phòng sản xuất nhóm B bị rò nước",
            desc:
              "Dàn lạnh số 2 (gần dãy B03–B05) nhỏ nước xuống bàn từ sáng 2/10, đã tạm dời 3 máy sang dãy C.\n\n" +
              "- Đã báo bảo trì toà nhà\n" +
              "- Cần kiểm tra ống thoát nước, vệ sinh lưới lọc\n" +
              "- Sửa xong báo trưởng ca để chuyển máy về chỗ cũ",
            priority: "urgent",
            creator: "lead2",
            assignees: ["admin"],
            status: "Đang làm",
            due: "overdue",
            createdDaysAgo: 8,
            files: [{ name: "Ảnh điều hoà rò nước.jpg", hint: "dàn lạnh điều hoà treo tường nhỏ nước xuống bàn làm việc, có xô hứng bên dưới" }],
            comments: [
              { by: "admin", at: 0.2, text: "Đã báo bảo trì toà nhà, họ hẹn chiều mai qua kiểm tra ạ." },
              {
                by: "lead2",
                at: 2.1,
                text: "Hôm nay vẫn còn nhỏ nước, mấy bạn ngồi gần phải để xô hứng. Có cách nào nhanh hơn không ạ?",
                replies: [
                  {
                    by: "admin",
                    at: 2.3,
                    text: "Thợ bảo phải thay ống thoát nước, đang chờ linh kiện 2–3 ngày.",
                    edited: "Thợ bảo phải thay ống thoát nước và bơm lại gas, đang chờ linh kiện 2–3 ngày."
                  }
                ]
              },
              {
                by: "boss",
                at: 5.4,
                text: "Phòng sản xuất mà để xô hứng nước cạnh máy là không ổn. Bảo trì toà nhà chậm thì gọi thợ ngoài luôn, xử lý dứt điểm trong tuần này.",
                replies: [
                  { by: "admin", at: 5.5, text: "Dạ em gọi bên ngoài rồi ạ, sáng thứ 2 họ qua thay luôn." },
                  { by: "linh", at: 5.6, text: "Trong lúc chờ @{lead2} cứ giữ 3 máy bên dãy C nhé, đừng chuyển về vội." }
                ]
              }
            ]
          },
          {
            title: "Thay pin UPS cho NAS và tủ mạng trước đợt chuyển NAS",
            priority: "high",
            creator: "linh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 24,
            comments: [
              { by: "minh", at: 1, text: "Pin cũ phồng 2 viên, anh đã đặt pin mới cùng loại, mai về." },
              {
                by: "minh",
                at: 2.8,
                text: "Đã thay xong, test rút điện 5 phút NAS vẫn chạy ổn, đủ thời gian tắt máy an toàn.",
                replies: [{ by: "linh", at: 2.9, text: "Tốt quá, cảm ơn Minh nhé 👍" }]
              }
            ]
          },
          {
            title: "Vệ sinh máy trạm dãy A: thổi bụi, thay keo tản nhiệt",
            priority: "normal",
            creator: "linh",
            assignees: ["lead1", "nv01", "nv02"],
            status: "Cần làm",
            due: "next_week",
            createdDaysAgo: 3,
            subtasks: ["Máy A01–A08", "Máy A09–A16"]
          },
          {
            title: "Vệ sinh máy trạm dãy B và dãy C, kiểm tra quạt",
            priority: "normal",
            creator: "linh",
            assignees: ["lead2", "nv10", "nv11"],
            status: "Cần làm",
            due: "later",
            createdDaysAgo: 3
          },
          {
            title: "Kiểm tra 3 bút Wacom bị lỗi double-click, nhảy nét",
            priority: "normal",
            creator: "lead1",
            assignees: ["minh", "nv06", "nv14"],
            status: "Đang làm",
            due: "tomorrow",
            createdDaysAgo: 4,
            comments: [
              { by: "nv06", at: 0.1, text: "Bút của em bị nhảy nét khi kéo mask, nhất là ở góc trên màn hình ạ." },
              {
                by: "minh",
                at: 1.2,
                text: "Đã cài lại driver bản mới cho máy @{nv06} và @{nv14}, 2 bạn dùng thử 1 ngày rồi báo nhé. Cây thứ 3 chắc phải thay ngòi và dây.",
                replies: [{ by: "nv14", at: 2, text: "Máy em hết bị rồi ạ, cảm ơn anh 🙏" }]
              }
            ]
          },
          {
            title: "Đổi 4 ghế bị gãy tay vịn ở dãy C",
            priority: "normal",
            creator: "lead2",
            assignees: [],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 12
          },
          {
            title: "Đi lại dây điện và lắp thêm ổ cắm dãy C",
            priority: "normal",
            creator: "linh",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 31
          },
          {
            title: "Chuẩn bị 6 chỗ ngồi và máy trạm cho đợt retoucher mới",
            desc:
              "Đợt tuyển 6 retoucher dự kiến nhận việc từ 19/10. Cần xong chỗ ngồi, máy và tài khoản trước ít nhất 2 ngày.\n\n" +
              "## Phân công\n" +
              "- @{admin}: bàn ghế, thẻ ra vào, tủ cá nhân\n" +
              "- @{minh}: máy trạm, phần mềm, tài khoản\n" +
              "- @{linh}: xếp vị trí theo nhóm ca\n\n" +
              "[ ] Chốt vị trí 6 bàn (ưu tiên dãy C sau khi đi lại điện)\n" +
              "[ ] Đặt mua màn hình (chờ @{boss} duyệt)\n" +
              "[ ] Kiểm tra lại đèn, rèm chống chói",
            priority: "high",
            creator: "boss",
            assignees: ["admin", "minh", "linh"],
            status: "Đang làm",
            due: "next_week",
            createdDaysAgo: 5,
            subtasks: [
              { title: "Lắp ráp 6 máy trạm cấu hình mới", assignees: ["minh"], status: "Đang làm" },
              { title: "Cài Photoshop, plugin và VPN", assignees: ["minh"], status: "Cần làm" },
              { title: "Tạo tài khoản Nesso Work và thư mục NAS", assignees: ["admin"], status: "Cần làm" },
              { title: "Calibrate 6 màn hình mới", assignees: ["khoa"], status: "Cần làm" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Cố gắng xong trước ngày các bạn vào làm, đừng để ngày đầu tiên ngồi chờ máy nhé."
              },
              {
                by: "minh",
                at: 2.2,
                text: "Đã đủ linh kiện 4 máy, 2 máy còn lại chờ RAM về khoảng thứ 4 tuần sau anh ạ.",
                replies: [{ by: "boss", at: 2.4, text: "Ok, thiếu gì cứ báo sớm, đừng để trễ." }]
              },
              {
                by: "linh",
                at: 3.5,
                text: "Chị xếp 4 bạn vào nhóm A, 2 bạn nhóm B, ngồi cạnh người kèm cặp cho tiện hỏi bài."
              },
              {
                by: "admin",
                at: 4.6,
                text: "Bàn ghế đủ rồi ạ, thẻ ra vào em làm sau khi có danh sách chính thức."
              }
            ]
          },
          {
            title: "Duyệt phương án thanh lý 8 màn hình cũ không còn chuẩn màu",
            desc:
              "Sau đợt kiểm kê Q3, có 8 màn hình đời cũ calibrate không còn đạt (delta E > 3), không dùng được cho đơn màu khắt khe.\n\n" +
              "Đề xuất:\n" +
              "1. Chuyển 3 màn sang hành chính, account (không cần chuẩn màu)\n" +
              "2. Thanh lý 5 màn còn lại\n" +
              "3. Bổ sung màn mới theo đề xuất mua sắm Q4\n\n" +
              "Danh sách chi tiết trong file kiểm kê Q3.",
            priority: "normal",
            creator: "khoa",
            assignees: ["boss"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 9,
            comments: [
              {
                by: "khoa",
                at: 2,
                text: "Em gửi anh xem phương án nhé, cần anh duyệt để @{admin} làm thủ tục thanh lý ạ."
              },
              {
                by: "admin",
                at: 6.1,
                text: "Bên thu mua đồ cũ hỏi lịch qua lấy, mình chưa duyệt nên em hẹn lại tuần sau."
              },
              {
                by: "khoa",
                at: 8.4,
                text: "@{boss} anh duyệt giúp em phương án này nha, đang kẹt luôn task mua màn hình bên mua sắm ạ 🙏"
              }
            ]
          },
          {
            title: "Kiểm kê thiết bị cuối quý 3",
            priority: "normal",
            creator: "admin",
            assignees: ["admin", "nv05"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 14,
            files: [{ name: "kiem-ke-thiet-bi-q3.xlsx", hint: "bảng kiểm kê máy trạm, màn hình, bút Wacom, UPS theo dãy bàn, cột tình trạng và ghi chú" }]
          },
          {
            title: "Bàn giao máy trạm và dữ liệu của Lộc trước ngày nghỉ",
            desc:
              "Lộc làm việc đến hết 12/9. Cần bàn giao xong trước 11/9:\n\n" +
              "[x] Chuyển các job đang làm dở cho @{nv07}\n" +
              "[x] Dọn thư mục cá nhân, chuyển file mẫu lên thư mục chung của nhóm\n" +
              "[x] Trả bút Wacom, thẻ ra vào\n" +
              "[x] IT khoá tài khoản sau 18h ngày 12/9",
            priority: "normal",
            creator: "lead1",
            assignees: ["loc", "lead1"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 33,
            comments: [
              {
                by: "loc",
                at: 1.1,
                text: "Em đã chuyển 4 job dở cho @{nv07}, có ghi chú style từng khách trong file txt ạ."
              },
              { by: "nv07", at: 1.3, text: "Mình nhận đủ rồi nha, cảm ơn Lộc." },
              {
                by: "loc",
                at: 3.2,
                text: "Bút và thẻ em gửi lại @{admin} rồi ạ. Cảm ơn mọi người thời gian qua 🙏",
                replies: [{ by: "lead1", at: 3.3, text: "Cảm ơn em, chúc em mọi việc thuận lợi ở chỗ mới nhé!" }]
              }
            ]
          },
          {
            title: "Lắp camera cửa ra vào phòng server",
            priority: "low",
            creator: "linh",
            assignees: ["minh"],
            status: "Huỷ",
            due: "none",
            createdDaysAgo: 36,
            comments: [
              { by: "linh", at: 3, text: "Toà nhà đã lắp camera hành lang nhìn được cửa phòng server, tạm huỷ task này nhé." }
            ]
          },
          {
            title: "Sắp xếp lại kho thiết bị dự phòng và dán nhãn",
            priority: "low",
            creator: "admin",
            assignees: ["nv07", "nv13"],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 1
          },
          {
            title: "Sửa điều hoà phòng sản xuất B (trùng)",
            priority: "urgent",
            creator: "lead1",
            assignees: [],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 8,
            trash: true
          }
        ]
      },

      // ---------------------------------------------------------------------------------------------
      {
        name: "Lịch ca & nhân sự ca",
        description: "Xếp ca, ca trực lễ, ca đêm mùa cao điểm, đổi ca, kèm cặp người mới.",
        color: "violet",
        tasks: [
          {
            title: "Xếp lịch ca trực lễ 2/9 cho nhóm A/B",
            desc:
              "Nghỉ lễ Quốc khánh 1–2/9, khách Úc và Mỹ vẫn gửi đơn nên cần giữ ca trực.\n\n" +
              "- Mỗi ca tối thiểu 4 retoucher + 1 trưởng ca\n" +
              "- Ưu tiên người tự nguyện đăng ký, tính phụ cấp lễ theo quy định\n" +
              "- @{acc1} báo trước lượng đơn dự kiến của từng khách",
            priority: "high",
            creator: "linh",
            assignees: ["lead1", "lead2"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 43,
            subtasks: ["Chốt danh sách trực ngày 1/9", "Chốt danh sách trực ngày 2/9"],
            comments: [
              {
                by: "acc1",
                at: 0.5,
                text: "Dự kiến 2 ngày lễ có khoảng 3 đơn BĐS bên Úc, mỗi đơn 150–250 ảnh, chưa thấy đơn gấp ạ."
              },
              {
                by: "loc",
                at: 1,
                text: "Em đăng ký trực ngày 1/9 ca sáng được không ạ?",
                replies: [{ by: "lead1", at: 1.1, text: "Ok em, đã ghi tên rồi nhé." }]
              },
              {
                by: "lead2",
                at: 2,
                text: "Nhóm B đủ 5 bạn trực ngày 2/9 rồi chị nhé.",
                replies: [{ by: "linh", at: 2.2, text: "Cảm ơn em, chị gửi anh duyệt luôn." }]
              }
            ]
          },
          {
            title: "Phê duyệt kế hoạch ca trực lễ Quốc khánh",
            priority: "normal",
            creator: "linh",
            assignees: ["boss"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 42
          },
          {
            title: "Lên lịch ca đêm 14–19/9 cho đợt đơn gấp khách BĐS Úc",
            desc:
              "Bên account báo tuần 14–19/9 các agency BĐS ở Úc vào mùa xuân, lượng đơn tăng gần gấp đôi, nhiều đơn yêu cầu trả trong 12 tiếng.\n\n" +
              "## Phương án\n" +
              "- Mở thêm ca đêm 22:00–6:00 từ thứ 2 đến thứ 6\n" +
              "- Mỗi đêm 5–6 người, không ai trực quá 3 đêm liên tiếp\n" +
              "- Có đồ ăn khuya và phụ cấp ca đêm\n\n" +
              "[x] Lấy đăng ký tự nguyện\n" +
              "[x] Thông báo lịch lên kênh sản xuất\n" +
              "[x] Đặt đồ ăn khuya cả tuần",
            priority: "urgent",
            creator: "linh",
            assignees: ["linh", "lead1", "lead2"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 28,
            subtasks: [
              { title: "Lấy danh sách đăng ký ca đêm", assignees: ["lead1", "lead2"], status: "Xong" },
              { title: "Thông báo lịch ca đêm cho cả xưởng", assignees: ["linh"], status: "Xong" }
            ],
            comments: [
              {
                by: "lead1",
                at: 0.3,
                text: "Nhóm A có 7 bạn đăng ký, em gửi danh sách trong file nhé chị.",
                files: [{ name: "lich-ca-dem-14-19-9.xlsx", hint: "lịch ca đêm 14–19/9, mỗi đêm 5–6 người, cột nhóm A/B và người QC trực" }]
              },
              {
                by: "lead2",
                at: 0.5,
                text: "Nhóm B được 5 bạn, còn thiếu đêm thứ 5. Em hỏi thêm @{nv11} và @{nv12} xem sao.",
                replies: [{ by: "nv11", at: 0.7, text: "Em trực thêm đêm thứ 5 được ạ." }]
              },
              {
                by: "boss",
                at: 1,
                text: "Ca đêm nhớ có người QC trực cùng, đơn gấp mà sai màu trời là khách phàn nàn ngay. @{khoa} sắp xếp giúp anh.",
                replies: [{ by: "khoa", at: 1.2, text: "Dạ em xếp 1 bạn QC mỗi đêm, em trực 2 đêm đầu." }]
              },
              {
                by: "linh",
                at: 8,
                text: "Tổng kết: 5 đêm ca đêm, trả đúng hạn hết, có 2 đơn bị khách góp ý màu trời đã sửa lại. Cảm ơn cả nhà đã vất vả 💪",
                edited:
                  "Tổng kết: 5 đêm ca đêm, trả đúng hạn toàn bộ đơn gấp, có 2 đơn bị khách góp ý màu trời và kéo cửa sổ, đã sửa lại trong ngày. Cảm ơn cả nhà đã vất vả 💪",
                replies: [{ by: "boss", at: 8.1, text: "Cảm ơn mọi người, tuần vừa rồi làm rất tốt 👏" }]
              }
            ]
          },
          {
            title: "Tổng hợp giờ tăng ca đợt 14–19/9 gửi kế toán",
            priority: "high",
            creator: "linh",
            assignees: ["lead1", "acc2"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 20,
            files: [{ name: "tong-hop-tang-ca-14-19-9.xlsx", hint: "bảng tổng hợp giờ tăng ca và ca đêm theo từng nhân viên, đối chiếu sản lượng ảnh theo đơn" }]
          },
          {
            title: "Xếp ca trực cuối tuần 26–27/9 trong thời gian đi team building",
            priority: "normal",
            creator: "linh",
            assignees: ["lead2"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 18,
            comments: [
              {
                by: "lead2",
                at: 0.4,
                text: "Có 4 bạn không đi Vũng Tàu được, em xếp các bạn trực 2 ngày, @{lead1} hỗ trợ online ạ."
              },
              { by: "lead1", at: 0.6, text: "Ok, mình để máy mở cả ngày, có gì cứ gọi nhé." },
              { by: "linh", at: 1, text: "Các bạn trực cuối tuần đó nhớ ghi nhận để được nghỉ bù nhé." }
            ]
          },
          {
            title: "Chốt chính sách phụ cấp ca đêm áp dụng từ Q4",
            desc:
              "Sau đợt cao điểm tháng 9, nhiều bạn hỏi phụ cấp ca đêm sẽ tính thế nào nếu Q4 tiếp tục mở ca đêm cho khách Úc, Mỹ.\n\n" +
              "Đề xuất (chờ anh duyệt):\n" +
              "- Phụ cấp ca đêm tính theo % lương giờ, áp dụng chung cả 2 nhóm\n" +
              "- Hỗ trợ đồ ăn khuya mỗi đêm\n" +
              "- Không xếp quá 3 đêm liên tiếp, có ngày nghỉ bù\n\n" +
              "@{boss} anh xem giúp em trước buổi giao ban thứ 2 nhé.",
            priority: "high",
            creator: "linh",
            assignees: ["boss", "linh"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 7,
            comments: [
              {
                by: "linh",
                at: 0.2,
                text: "Em để bảng so sánh với cách tính tháng 9 trong thư mục chung của phòng vận hành ạ."
              },
              {
                by: "boss",
                at: 2.5,
                text: "Hướng này ok. Phần % anh muốn xem thêm ảnh hưởng tới chi phí quý, em làm bảng tính thử 2 phương án giúp anh.",
                replies: [{ by: "linh", at: 2.7, text: "Dạ, em gửi lại trong tuần này ạ." }]
              },
              {
                by: "linh",
                at: 6.3,
                text: "@{boss} em đã cập nhật 2 phương án trong file, anh xem rồi chốt giúp em để kịp báo nhân viên ạ."
              }
            ]
          },
          {
            title: "Xếp lịch ca tháng 10 cho nhóm A và B",
            priority: "normal",
            creator: "linh",
            assignees: ["lead1", "lead2"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 13,
            files: [{ name: "lich-ca-thang-10.xlsx", hint: "lịch ca sáng/chiều/đêm tháng 10 theo tuần, nhóm A và B" }]
          },
          {
            title: "Xếp lịch ca tháng 11 (tính thêm 6 bạn mới)",
            priority: "normal",
            creator: "linh",
            assignees: ["lead1", "lead2"],
            status: "Cần làm",
            due: "later",
            createdDaysAgo: 2
          },
          {
            title: "Xử lý đề nghị đổi ca tuần 42 của nhóm B",
            desc:
              "Các đề nghị đổi ca đã nhận:\n" +
              "- @{nv12} đổi ca chiều thứ 3 sang ca sáng (đi khám răng)\n" +
              "- @{nv15} đổi với @{nv10} ngày thứ 5\n\n" +
              "Các bạn xác nhận lại trong comment của task này nhé.",
            priority: "normal",
            creator: "lead2",
            assignees: ["lead2", "nv12", "nv15"],
            status: "Đang làm",
            due: "none",
            createdDaysAgo: 2
          },
          {
            title: "Bố trí ca tối cho đơn làm thử khách Nhật (cut-out sản phẩm)",
            desc:
              "Khách Nhật mới gửi 120 ảnh làm thử, muốn nhận lúc 8h sáng giờ bên đó (6h sáng bên mình), nên cần 1 ca tối ngắn.\n\n" +
              "- @{nv03} và @{nv07} làm chính vì quen tay clipping path\n" +
              "- Yêu cầu: viền sạch, không răng cưa, giữ bóng đổ tự nhiên\n" +
              "- Mỗi batch xong gửi @{khoa} QC 100% trước khi giao",
            priority: "high",
            creator: "lead1",
            assignees: ["lead1", "nv03", "nv07"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 4,
            comments: [
              { by: "nv03", at: 1.5, text: "Batch 1 (40 ảnh) xong rồi ạ, em gửi anh Khoa QC." },
              {
                by: "khoa",
                at: 1.8,
                text: "Có 6 ảnh thú bông viền lông còn răng cưa, sửa lại nhé. Khách này soi zoom 200% đấy.",
                replies: [{ by: "nv03", at: 1.9, text: "Dạ em sửa ngay ạ." }]
              },
              {
                by: "acc1",
                at: 3.2,
                text: "Khách phản hồi batch 1 ok, đang chờ batch 2 và 3. Nếu đạt thì tháng sau có đơn đều ạ 🤞"
              }
            ]
          },
          {
            title: "Phân công người kèm cặp cho 6 retoucher mới",
            desc:
              "Mỗi bạn kèm 2 người mới trong 2 tuần đầu: hướng dẫn quy trình nhận job, đặt tên file, checklist QC v2.\n\n" +
              "- Tuần 1: làm ảnh mẫu, chưa giao đơn thật\n" +
              "- Tuần 2: làm đơn thường, người kèm review 100%\n\n" +
              "[ ] Ghép cặp xong trước ngày các bạn nhận việc\n" +
              "[ ] Chuẩn bị bộ ảnh mẫu HDR, sky replacement, cut-out",
            priority: "normal",
            creator: "lead1",
            assignees: ["nv05", "nv09", "nv15"],
            status: "Cần làm",
            due: "next_week",
            createdDaysAgo: 3,
            subtasks: ["Ghép cặp người kèm – nhân viên mới", "Chuẩn bị bộ ảnh mẫu cho tuần đầu"]
          },
          {
            title: "Xếp ca bù cho bạn nghỉ ốm nhóm A tuần này",
            priority: "urgent",
            creator: "lead1",
            assignees: ["lead1", "nv04", "nv08"],
            status: "Đang làm",
            due: "today",
            createdDaysAgo: 1,
            comments: [
              {
                by: "lead1",
                at: 0.2,
                text: "@{nv04} và @{nv08} chia nhau trực bù ca chiều nay và ca sáng mai giúp mình nhé, có đơn HDR 240 ảnh phải trả trước 9h sáng thứ 2.",
                replies: [
                  { by: "nv04", at: 0.3, text: "Dạ em trực chiều nay được ạ." },
                  { by: "nv08", at: 0.5, text: "Sáng mai em vào ạ 👍" }
                ]
              }
            ]
          },
          {
            title: "Ca trực Chủ nhật 11/10 cho nhóm B",
            priority: "normal",
            creator: "lead2",
            assignees: ["lead2", "nv10", "nv13"],
            status: "Chờ duyệt",
            due: "tomorrow",
            createdDaysAgo: 4
          },
          {
            title: "Khảo sát nguyện vọng ca làm việc trước khi xếp lịch Q4",
            priority: "low",
            creator: "linh",
            assignees: ["linh"],
            status: "Huỷ",
            due: "past",
            createdDaysAgo: 22
          },
          {
            title: "Lên lịch ca đêm 14–19/9 (trùng)",
            priority: "low",
            creator: "lead2",
            assignees: [],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 28,
            trash: true
          }
        ]
      },

      // ---------------------------------------------------------------------------------------------
      {
        name: "Mua sắm & văn phòng phẩm",
        description: "Đề xuất mua, báo giá nhà cung cấp, văn phòng phẩm, quà tặng.",
        color: "amber",
        tasks: [
          {
            title: "Xin 3 báo giá ghế công thái học thay cho dãy C",
            desc:
              "Dãy C có 4 ghế gãy tay vịn, nhiều bạn ngồi ca dài kêu đau lưng. Xin 3 báo giá để so sánh:\n\n" +
              "- Có tựa đầu, lưng lưới, chỉnh được độ cao tay vịn\n" +
              "- Bảo hành tối thiểu 2 năm\n" +
              "- Giao trước khi nhân sự mới vào\n\n" +
              "Tham khảo mẫu: [catalog ghế văn phòng](https://example.com/catalog/ghe-van-phong)",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Chờ duyệt",
            due: "week",
            createdDaysAgo: 11,
            files: [{ name: "bao-gia-ghe-cong-thai-hoc.pdf", hint: "bảng so sánh 3 mẫu ghế công thái học: tựa đầu, tay vịn, bảo hành, thời gian giao" }],
            comments: [
              { by: "admin", at: 3, text: "Đã có đủ 3 báo giá, mẫu số 2 bảo hành 3 năm, giao trong 5 ngày ạ." },
              {
                by: "lead2",
                at: 3.5,
                text: "Cho các bạn ngồi thử được không ạ? Ghế cũ cũng chọn theo catalog mà ngồi lâu rất mỏi.",
                replies: [
                  { by: "admin", at: 4, text: "Bên cung cấp cho mượn 1 ghế mẫu, thứ 2 mang qua để mọi người thử nhé." }
                ]
              },
              {
                by: "linh",
                at: 9.2,
                text: "Ghế mẫu mọi người thử đều ok, gộp vào đề xuất màn hình trình anh duyệt luôn nhé @{admin}."
              }
            ]
          },
          {
            title: "Ký duyệt đề xuất mua 6 màn hình chuẩn màu cho nhân sự mới",
            desc:
              "Kèm theo đợt tuyển 6 retoucher, cần 6 màn hình chuẩn màu cùng dòng với dãy A để đồng bộ calibrate.\n\n" +
              "- Đã so sánh 3 nhà cung cấp, chọn bên giao nhanh và bảo hành tại chỗ\n" +
              "- Gộp chung đơn hàng với ghế dãy C để giao 1 lần\n\n" +
              "File đề xuất đính kèm, @{boss} ký duyệt giúp trước thứ 7 để kịp đặt hàng ạ.",
            priority: "high",
            creator: "admin",
            assignees: ["boss"],
            status: "Chờ duyệt",
            due: "today",
            createdDaysAgo: 4,
            files: [{ name: "de-xuat-mua-man-hinh-nhan-su-moi.pdf", hint: "tờ đề xuất mua sắm 6 màn hình chuẩn màu, có ô ký duyệt của giám đốc" }],
            comments: [
              {
                by: "boss",
                at: 1.3,
                text: "Sao không lấy dòng mới hơn? Anh thấy dòng này ra lâu rồi.",
                replies: [
                  {
                    by: "khoa",
                    at: 1.5,
                    text: "Dạ dòng này calibrate ổn định và dùng chung profile với dãy A được, dòng mới em chưa test ạ."
                  },
                  { by: "boss", at: 1.7, text: "Ok, hợp lý." }
                ]
              },
              {
                by: "admin",
                at: 3.9,
                text: "@{boss} anh ký giúp em trong hôm nay nhé, bên cung cấp chỉ giữ hàng đến hết hôm nay thôi ạ."
              }
            ]
          },
          {
            title: "Đặt bánh trung thu cho toàn công ty",
            priority: "high",
            creator: "boss",
            assignees: ["admin", "linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 30,
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Năm nay mỗi người 1 hộp nhé, các bạn ca đêm và ca trực cũng phải có đủ."
              },
              {
                by: "admin",
                at: 2,
                text: "Em chốt danh sách 38 suất (gồm cả thực tập sinh), đặt bánh nhân truyền thống và một ít bánh chay ạ.",
                edited:
                  "Em chốt danh sách 40 suất (gồm cả thực tập sinh và 2 bạn mới vào), đặt bánh nhân truyền thống và một ít bánh chay ạ."
              },
              {
                by: "linh",
                at: 14,
                text: "Bánh về đủ rồi, chiều 25/9 phát lúc tiệc 16h30. Các bạn ca chiều tối nhận ở bàn lễ tân nhé.",
                replies: [{ by: "nv09", at: 15.2, text: "Bánh ngon quá, cảm ơn công ty ạ 🥮" }]
              }
            ]
          },
          {
            title: "Chốt ngân sách quà Trung thu và tiệc chiều 25/9",
            priority: "normal",
            creator: "admin",
            assignees: ["boss", "admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 29
          },
          {
            title: "Mua quà 20/10 cho chị em toàn công ty",
            desc:
              "Năm nay tặng quà thiết thực hơn, tránh hoa để rồi bỏ.\n\n" +
              "- @{admin}: chốt danh sách, đặt quà\n" +
              "- @{an}: thiết kế thiệp và bài đăng nội bộ\n" +
              "- Trao quà sáng thứ 3 ngày 20/10, ca chiều/tối nhận ở bàn trưởng ca",
            priority: "normal",
            creator: "boss",
            assignees: ["admin", "an"],
            status: "Cần làm",
            due: "next_week",
            createdDaysAgo: 2,
            subtasks: ["Chốt danh sách chị em (cả ca đêm)", "Chọn quà và thiết kế thiệp"],
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Ngân sách giữ như năm ngoái, nếu được thì thêm bánh ngọt buổi chiều cho cả công ty."
              },
              {
                by: "an",
                at: 1.4,
                text: "Em gửi 3 mẫu thiệp trong kênh marketing rồi, chị @{linh} chọn giúp em mẫu nha.",
                replies: [{ by: "linh", at: 1.6, text: "Chị thích mẫu số 2, màu nhẹ nhàng 😍" }]
              }
            ]
          },
          {
            title: "Mua thêm khăn lau màn hình và dung dịch vệ sinh chuyên dụng",
            priority: "low",
            creator: "khoa",
            assignees: ["nv11", "nv14"],
            status: "Đang làm",
            due: "none",
            createdDaysAgo: 5
          },
          {
            title: "So sánh báo giá ổ cứng dự phòng cho NAS mới",
            priority: "low",
            creator: "linh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "none",
            createdDaysAgo: 6
          },
          {
            title: "Bổ sung nước uống, cà phê, trà cho pantry tầng 2 và tầng 5",
            priority: "low",
            creator: "admin",
            assignees: [],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 0
          },
          {
            title: "Đặt in danh thiếp cho trưởng ca và account",
            priority: "low",
            creator: "admin",
            assignees: ["admin"],
            status: "Huỷ",
            due: "past",
            createdDaysAgo: 25
          }
        ]
      },

      // ---------------------------------------------------------------------------------------------
      {
        name: "Quy trình nội bộ",
        description: "Nội quy, bàn giao ca, an toàn dữ liệu, 5S, hướng dẫn nội bộ.",
        color: "teal",
        tasks: [
          {
            title: "Soạn quy trình bàn giao ca v2 (checklist cuối ca)",
            desc:
              "Tháng 9 có mấy lần ca sau không biết job nào của khách nào đang dở, dẫn tới trả trễ. Bản v2 bắt buộc dùng checklist khi giao ca.\n\n" +
              "## Checklist cuối ca\n" +
              "[ ] Cập nhật trạng thái tất cả job trên Nesso Work\n" +
              "[ ] Ghi chú job dở: còn bao nhiêu ảnh, lưu ý style của khách\n" +
              "[ ] Báo trưởng ca sau các đơn có deadline trong 6 tiếng tới\n" +
              "[ ] Đóng file, không để file mở trên máy người khác\n\n" +
              "Bản nháp: [quy trình bàn giao ca v2](https://nesso.example/docs/ban-giao-ca-v2)\n\n" +
              "@{boss} anh xem qua giúp em trước khi áp dụng chính thức nhé.",
            priority: "high",
            creator: "linh",
            assignees: ["linh", "lead1", "lead2"],
            status: "Chờ duyệt",
            due: "week",
            createdDaysAgo: 10,
            files: [{ name: "noi-quy-ban-giao-ca-v2.docx", hint: "quy trình bàn giao ca phiên bản 2, có checklist cuối ca và bảng ký nhận" }],
            subtasks: [
              { title: "Soạn checklist cuối ca", assignees: ["linh"], status: "Xong" },
              { title: "Chạy thử 1 tuần ở nhóm A", assignees: ["lead1"], status: "Xong" },
              { title: "Chỉnh theo góp ý của trưởng ca", assignees: ["lead2"], status: "Đang làm" }
            ],
            comments: [
              {
                by: "lead1",
                at: 3,
                text: "Nhóm A chạy thử từ thứ 2, các bạn quen rồi, chỉ hay quên mục ghi chú style khách."
              },
              {
                by: "lead2",
                at: 5,
                text: "Đề xuất thêm mục: chụp màn hình thư mục job dở gửi vào thread của ca, nhìn nhanh hơn ạ.",
                edited:
                  "Đề xuất thêm mục: chụp màn hình thư mục job dở gửi vào thread của ca trên kênh sản xuất, ca sau nhìn nhanh hơn ạ.",
                replies: [{ by: "linh", at: 5.3, text: "Ý hay, chị thêm vào bản v2 luôn." }]
              },
              {
                by: "boss",
                at: 9.1,
                text: "Anh đọc rồi, ổn. Thêm 1 dòng: ai bỏ qua checklist 2 lần trong tháng thì trưởng ca nhắc trực tiếp. Áp dụng từ thứ 2 tuần sau."
              }
            ]
          },
          {
            title: "Góp ý nội quy ca làm việc sửa đổi 2026",
            desc:
              "Bản sửa đổi tập trung vào: giờ vào ca linh hoạt ±15 phút, quy định nghỉ giữa ca, xin đổi ca qua Nesso Work thay cho Zalo.\n\n" +
              "> Mục tiêu: nội quy ngắn, dễ nhớ, in vừa 1 trang A4.\n\n" +
              "Anh góp ý trực tiếp trong comment giúp em ạ.",
            priority: "normal",
            creator: "linh",
            assignees: ["boss", "linh"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 6,
            comments: [
              {
                by: "boss",
                at: 3.1,
                text: "Mục đi trễ đang để nhẹ quá, ghi rõ trễ quá 3 lần/tháng thì xử lý thế nào.",
                replies: [{ by: "linh", at: 3.3, text: "Dạ em bổ sung, gửi lại anh trước thứ 4 ạ." }]
              }
            ]
          },
          {
            title: "Bổ sung ký cam kết bảo mật dữ liệu khách cho nhân viên còn thiếu",
            desc:
              "Rà soát hồ sơ thấy còn 3 bạn chưa ký bản cam kết bảo mật mới (cập nhật theo yêu cầu của khách Nhật). Các bạn qua phòng hành chính ký giúp trong tuần nhé.\n\n" +
              "- Không mang ảnh khách ra khỏi NAS, không dùng USB cá nhân\n" +
              "- Không chụp màn hình ảnh khách gửi lên mạng xã hội\n" +
              "- Đọc trước bản tóm tắt: [cam kết bảo mật](https://nesso.example/docs/cam-ket-bao-mat)",
            priority: "high",
            creator: "admin",
            assignees: ["nv02", "nv04", "nv06"],
            status: "Cần làm",
            due: "week",
            createdDaysAgo: 5
          },
          {
            title: "Cập nhật quy trình lưu file lên NAS mới sau đợt chuyển",
            priority: "high",
            creator: "linh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 19
          },
          {
            title: "Rà soát phân quyền thư mục NAS mới theo nhóm ca",
            priority: "urgent",
            creator: "linh",
            assignees: ["minh", "lead1"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 19,
            subtasks: [
              { title: "Kiểm tra quyền nhóm A", assignees: ["lead1"], status: "Xong" },
              { title: "Kiểm tra quyền nhóm B", assignees: ["lead2"], status: "Xong" }
            ],
            comments: [
              {
                by: "lead1",
                at: 0.05,
                text: "Sáng nay mấy bạn nhóm A không ghi được vào thư mục `Output` của khách Úc, chỉ đọc được thôi ạ.",
                files: [{ name: "Ảnh lỗi phân quyền NAS.png", hint: "hộp thoại Windows báo không có quyền ghi vào thư mục mạng" }]
              },
              {
                by: "minh",
                at: 0.2,
                text: "Do nhóm quyền cũ chưa map sang NAS mới, anh đang sửa, khoảng 30 phút nữa thử lại nhé.",
                replies: [{ by: "lead1", at: 0.4, text: "Ghi được rồi ạ, cảm ơn anh!" }]
              },
              {
                by: "minh",
                at: 1.1,
                text: "Đã rà toàn bộ thư mục khách: nhóm A/B chỉ ghi được vào thư mục job của nhóm mình, QC đọc được tất cả.",
                replies: [{ by: "khoa", at: 1.3, text: "QC xem được hết rồi, ok nhé." }]
              }
            ]
          },
          {
            title: "In và dán QC checklist v2 tại mỗi dãy bàn",
            priority: "normal",
            creator: "khoa",
            assignees: ["khoa", "nv09"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 6,
            files: [{ name: "Ảnh dán checklist dãy B.jpg", hint: "tờ checklist QC v2 khổ A4 dán cạnh màn hình ở dãy bàn B" }]
          },
          {
            title: "Áp dụng 5S khu bàn làm việc sản xuất – đợt 1",
            desc:
              "Đợt 1 làm ở dãy B và C trước, dãy A làm sau khi vệ sinh máy xong.\n\n" +
              "1. Sàng lọc: bỏ giấy tờ, dây cáp không dùng\n" +
              "2. Sắp xếp: dán nhãn dây cáp, cố định hub USB\n" +
              "3. Sạch sẽ: lau bàn, màn hình cuối ca thứ 7\n" +
              "4. Săn sóc: chụp ảnh trước/sau mỗi dãy\n" +
              "5. Sẵn sàng: trưởng ca kiểm tra ngẫu nhiên hàng tuần",
            priority: "normal",
            creator: "linh",
            assignees: ["lead2", "nv05", "nv12"],
            status: "Đang làm",
            due: "later",
            createdDaysAgo: 8,
            subtasks: ["Dọn bàn và dán nhãn dây cáp dãy B", "Chụp ảnh trước/sau từng dãy"]
          },
          {
            title: "Quy định đặt tên file khi giao nhận giữa account và sản xuất",
            desc:
              "Hiện mỗi người đặt tên một kiểu, QC mất thời gian tìm file. Đề xuất thống nhất:\n\n" +
              "- Thư mục đơn: `YYMMDD_khach_dich-vu_so-anh`, ví dụ `261008_au-agency-03_hdr_240`\n" +
              "- File trả: giữ tên gốc của khách, không thêm hậu tố\n" +
              "- File sửa lại: thêm `_r1`, `_r2`…\n\n" +
              "[ ] Account áp dụng cho đơn mới từ tuần sau\n" +
              "[ ] Sản xuất đổi tên đơn đang chạy khi bàn giao ca",
            priority: "normal",
            creator: "khoa",
            assignees: ["acc1", "acc2", "khoa"],
            status: "Chờ duyệt",
            due: "none",
            createdDaysAgo: 7,
            comments: [
              {
                by: "acc2",
                at: 1.5,
                text: "Bên em ok, chỉ xin bỏ phần dịch vụ vì có đơn mix nhiều dịch vụ ạ.",
                replies: [
                  { by: "khoa", at: 2, text: "Đơn mix thì ghi `mix` nhé, vẫn cần để QC biết mà chia người." }
                ]
              },
              { by: "acc1", at: 4, text: "Thống nhất rồi ạ, em gửi hướng dẫn cho cả bên account trong kênh chung." }
            ]
          },
          {
            title: "Hướng dẫn sử dụng Nesso Work cho trưởng ca và account",
            priority: "normal",
            creator: "boss",
            assignees: ["linh", "admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 44,
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Từ tuần này giao việc, báo tiến độ đều lên Nesso Work, hạn chế Zalo. Các trưởng ca làm mẫu trước nhé."
              },
              {
                by: "admin",
                at: 2.3,
                text: "Đã tạo tài khoản cho toàn bộ nhân viên và hướng dẫn 2 buổi cho trưởng ca, account ạ.",
                replies: [{ by: "boss", at: 2.5, text: "Tốt, tuần sau anh xem số task cập nhật của từng nhóm." }]
              }
            ]
          },
          {
            title: "Quy trình xử lý khiếu nại màu trời và kéo cửa sổ từ khách",
            priority: "high",
            creator: "boss",
            assignees: ["khoa", "acc1"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 21,
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Tuần này 2 khách phàn nàn màu trời na ná nhau, phải có quy trình xử lý thống nhất, không để mỗi người trả lời một kiểu."
              },
              {
                by: "khoa",
                at: 3,
                text: "Em soạn xong: account nhận khiếu nại → QC xác nhận lỗi trong 2 tiếng → sản xuất sửa ưu tiên → account phản hồi kèm ảnh trước/sau.",
                replies: [
                  { by: "acc1", at: 3.2, text: "Bên account thêm mẫu email phản hồi tiếng Anh vào quy trình rồi ạ." }
                ]
              }
            ]
          },
          {
            title: "Cập nhật sơ đồ thoát hiểm và danh sách liên hệ khẩn cấp các tầng",
            desc:
              "Sau khi khối văn phòng chuyển lên tầng 5, sơ đồ thoát hiểm cũ không còn đúng.\n\n" +
              "- In sơ đồ mới cho tầng 2 và tầng 5\n" +
              "- @{nv01}, @{nv09} (đội PCCC cơ sở) kiểm tra lại bình chữa cháy, đèn exit\n" +
              "- Dán danh sách liên hệ khẩn cấp cạnh cửa ra vào",
            priority: "normal",
            creator: "admin",
            assignees: ["admin", "nv01", "nv09"],
            status: "Cần làm",
            due: "overdue",
            createdDaysAgo: 14,
            comments: [
              {
                by: "linh",
                at: 9,
                text: "Task này quá hạn rồi, tuần sau toà nhà kiểm tra PCCC, @{admin} ưu tiên giúp chị nhé."
              },
              {
                by: "admin",
                at: 9.3,
                text: "Dạ em in sơ đồ xong rồi, còn chờ @{nv01} @{nv09} kiểm tra bình chữa cháy ca sáng thứ 2 ạ."
              }
            ]
          }
        ]
      }
    ]
  },

  // ===================================================================================================
  // CVP — Chuyển văn phòng tầng 5 (archived)
  // ===================================================================================================
  {
    key: "CVP",
    name: "Chuyển văn phòng tầng 5",
    description:
      "Kế hoạch chuyển khối văn phòng (ban giám đốc, vận hành, QC, account, marketing, IT) lên tầng 5 vào đầu tháng 9; sản xuất giữ nguyên tầng 2. Đã hoàn thành, lưu trữ để tra cứu.",
    icon: "package",
    color: "orange",
    visibility: "public",
    owner: "admin",
    createdOn: "2026-08-25",
    archivedOn: "2026-09-26",
    members: {
      admin: "manage",
      boss: "manage",
      linh: "manage",
      minh: "submit",
      lead1: "submit"
    },
    workflow: opsWorkflow,
    lists: [
      {
        name: "Kế hoạch chuyển",
        description: "Mặt bằng, sơ đồ chỗ ngồi, mạng, lịch chuyển ngày 5/9.",
        color: "orange",
        tasks: [
          {
            title: "Khảo sát mặt bằng tầng 5 và đo vị trí đặt bàn",
            priority: "high",
            creator: "admin",
            assignees: ["admin", "linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 45
          },
          {
            title: "Vẽ sơ đồ chỗ ngồi tầng 5 cho khối văn phòng",
            desc:
              "Khối văn phòng chuyển lên tầng 5, sản xuất giữ nguyên tầng 2.\n\n" +
              "- QC ngồi gần cửa sổ hướng bắc, tránh nắng chiếu màn hình\n" +
              "- Account cạnh phòng họp nhỏ để tiện gọi khách\n" +
              "- IT ngồi gần tủ mạng",
            priority: "high",
            creator: "linh",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 44,
            files: [{ name: "so-do-cho-ngoi-tang-5.png", hint: "sơ đồ mặt bằng tầng 5 với vị trí bàn theo phòng ban, phòng họp và tủ mạng" }],
            comments: [
              { by: "admin", at: 1, text: "Em gửi sơ đồ v1, mọi người góp ý giúp ạ." },
              {
                by: "boss",
                at: 1.3,
                text: "Phòng anh không cần to, dành chỗ đó làm phòng họp 6 người. Bàn QC nhớ có rèm.",
                replies: [
                  { by: "admin", at: 1.5, text: "Dạ em sửa theo ý anh, bản v2 em cập nhật vào file luôn ạ." }
                ]
              },
              {
                by: "minh",
                at: 2,
                text: "Tủ mạng đặt góc trái thì phải kéo thêm dây khoảng 15m, em đề xuất dời sang cạnh phòng họp.",
                replies: [{ by: "linh", at: 2.2, text: "Ok, theo đề xuất của Minh nhé." }]
              }
            ]
          },
          {
            title: "Làm việc với ban quản lý toà nhà về lịch chuyển và thang máy",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 43
          },
          {
            title: "Kéo mạng LAN, wifi và điện cho tầng 5",
            desc:
              "Yêu cầu tối thiểu:\n" +
              "- 24 điểm mạng LAN, mỗi bàn 1 điểm\n" +
              "- 2 access point phủ toàn tầng\n" +
              "- Đường truyền riêng xuống NAS tầng 2\n\n" +
              "[x] Khảo sát cùng bên thi công\n" +
              "[x] Đi dây\n" +
              "[x] Test tốc độ copy file từ NAS",
            priority: "urgent",
            creator: "linh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 43,
            subtasks: [
              { title: "Đi dây mạng 24 điểm", assignees: ["minh"], status: "Xong" },
              { title: "Lắp access point và test tốc độ", assignees: ["minh"], status: "Xong" }
            ],
            comments: [
              {
                by: "minh",
                at: 8,
                text: "Đã nghiệm thu, copy thư mục 2GB từ NAS lên tầng 5 mất khoảng 25 giây, ổn ạ.",
                files: [{ name: "bien-ban-nghiem-thu-dien-mang-tang-5.pdf", hint: "biên bản nghiệm thu điện và mạng tầng 5, danh sách điểm mạng đã test" }],
                replies: [{ by: "boss", at: 8.2, text: "Tốt 👍" }]
              }
            ]
          },
          {
            title: "Thông báo lịch chuyển và hướng dẫn đóng thùng cho từng phòng",
            desc:
              "Lịch chuyển: **thứ 7 ngày 5/9**, bắt đầu 13h sau khi hết ca sáng.\n\n" +
              "- Mỗi người tự đóng đồ cá nhân, dán nhãn tên + phòng ban\n" +
              "- Máy tính, màn hình để nguyên, IT tháo và chuyển\n" +
              "- Tài liệu giấy cho vào thùng riêng, ghi rõ “tài liệu”",
            priority: "normal",
            creator: "linh",
            assignees: ["linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 41
          },
          {
            title: "Chuyển máy và đồ đạc khối văn phòng lên tầng 5 ngày 5/9",
            desc:
              "Phân công ngày chuyển:\n" +
              "- @{admin}: điều phối bên vận chuyển, thang máy\n" +
              "- @{minh}: tháo lắp máy, kiểm tra mạng\n" +
              "- @{lead1}: thêm 4 bạn sản xuất ca sáng ở lại hỗ trợ khuân đồ\n\n" +
              "Dự kiến xong trước 18h, Chủ nhật để dự phòng.",
            priority: "high",
            creator: "admin",
            assignees: ["admin", "minh", "lead1"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 38,
            comments: [
              { by: "lead1", at: 4.2, text: "Nhóm A có 4 bạn ở lại hỗ trợ, đồ nặng đã lên hết tầng 5 lúc 16h ạ." },
              {
                by: "boss",
                at: 4.4,
                text: "Cảm ơn mọi người, tối nay công ty mời cả đội đi ăn nhé 🍲",
                replies: [{ by: "linh", at: 4.45, text: "Em đặt bàn rồi ạ, 19h nhé cả nhà." }]
              },
              {
                by: "admin",
                at: 5,
                text: "Chủ nhật không cần làm thêm, mọi thứ đã xong. Thứ 2 vào làm bình thường ở tầng 5 ạ."
              }
            ]
          },
          {
            title: "Kiểm tra máy móc và kết nối sau khi chuyển",
            priority: "high",
            creator: "linh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 36,
            comments: [
              {
                by: "minh",
                at: 4.1,
                text: "Sáng thứ 2 có 2 máy account không nhận màn hình thứ 2 do lỏng cáp, đã xử lý xong.",
                edited:
                  "Sáng thứ 2 có 2 máy account không nhận màn hình thứ 2 do lỏng cáp, 1 máy QC mất kết nối NAS, đã xử lý xong hết."
              }
            ]
          },
          {
            title: "Sắp xếp phòng họp nhỏ thành phòng phỏng vấn",
            priority: "low",
            creator: "admin",
            assignees: ["admin"],
            status: "Huỷ",
            due: "past",
            createdDaysAgo: 40
          }
        ]
      },
      {
        name: "Hậu cần",
        description: "Vận chuyển, thùng carton, dán nhãn, bàn giao mặt bằng cũ.",
        color: "amber",
        tasks: [
          {
            title: "Thuê đơn vị vận chuyển và đặt thùng carton",
            desc:
              "Lấy báo giá 2 bên vận chuyển, ưu tiên bên có kinh nghiệm chuyển thiết bị điện tử và có bảo hiểm hàng hoá.\n\n" +
              "[x] 60 thùng carton + băng keo + màng xốp\n" +
              "[x] Mượn xe đẩy hàng của toà nhà\n" +
              "[x] Chốt bên vận chuyển",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 42,
            comments: [
              {
                by: "boss",
                at: 2,
                text: "Chọn bên có bảo hiểm, màn hình đồ hoạ mà vỡ thì mất nhiều hơn khoản tiết kiệm được.",
                replies: [
                  {
                    by: "admin",
                    at: 2.2,
                    text: "Dạ em chọn bên thứ 2, có bảo hiểm và từng chuyển cho văn phòng thiết kế ạ."
                  }
                ]
              }
            ]
          },
          {
            title: "Dán nhãn thùng theo phòng ban và người sở hữu",
            priority: "low",
            creator: "admin",
            assignees: ["lead1", "admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 39
          },
          {
            title: "Vệ sinh khu vực cũ và bàn giao lại mặt bằng cho toà nhà",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 35
          },
          {
            title: "Đặt bảng tên phòng ban và biển chỉ dẫn tầng 5",
            priority: "low",
            creator: "linh",
            assignees: ["admin"],
            status: "Huỷ",
            due: "past",
            createdDaysAgo: 37
          }
        ]
      }
    ]
  }
];
