/**
 * INVENTED seed content (LOCAL DEVELOPMENT ONLY): projects "Marketing & Thương hiệu" (MKT) and
 * "Tuyển dụng & Đào tạo" (HR). Everything is fiction — no real clients, prices or staff names.
 */
import type { ProjectSeed, StatusSeed } from "../types.js";

/** Joins lines with "\n" so mini-markup stays readable here ("" = blank line = new paragraph). */
const md = (...lines: string[]): string => lines.join("\n");

const mktWorkflow: StatusSeed[] = [
  { name: "Ý tưởng", category: "active", color: "slate" },
  { name: "Đang viết", category: "active", color: "sky" },
  { name: "Đang thiết kế", category: "active", color: "violet" },
  { name: "Chờ duyệt", category: "active", color: "amber" },
  { name: "Đã đăng", category: "done", color: "green" },
  { name: "Huỷ", category: "closed", color: "gray" }
];

const hrWorkflow: StatusSeed[] = [
  { name: "Cần làm", category: "active", color: "slate" },
  { name: "Đang làm", category: "active", color: "blue" },
  { name: "Xong", category: "done", color: "green" },
  { name: "Huỷ", category: "closed", color: "gray" }
];

const hiringWorkflow: StatusSeed[] = [
  { name: "Nhận CV", category: "active", color: "slate" },
  { name: "Phỏng vấn", category: "active", color: "sky" },
  { name: "Làm bài test", category: "active", color: "violet" },
  { name: "Đề nghị", category: "active", color: "amber" },
  { name: "Đã nhận việc", category: "done", color: "green" },
  { name: "Loại", category: "closed", color: "gray" }
];

export const projectsMktHr: ProjectSeed[] = [
  // ================================================================================================
  // MKT — Marketing & Thương hiệu
  // ================================================================================================
  {
    key: "MKT",
    name: "Marketing & Thương hiệu",
    description:
      "Nội dung fanpage/LinkedIn, portfolio before/after, quảng cáo thử nghiệm, sự kiện và bộ nhận diện thương hiệu.",
    icon: "megaphone",
    color: "pink",
    visibility: "public",
    owner: "an",
    members: {
      an: "manage",
      boss: "manage",
      linh: "manage",
      hanh: "submit",
      acc1: "submit",
      acc2: "submit",
      minh: "submit",
      khoa: "view",
      nv02: "view",
      nv09: "view"
    },
    workflow: mktWorkflow,
    createdOn: "2026-08-26",
    lists: [
      // ---------------------------------------------------------------------------------------------
      {
        name: "Nội dung mạng xã hội",
        description: "Lịch đăng fanpage, LinkedIn, reels và các bài before/after hằng tuần.",
        color: "pink",
        tasks: [
          {
            title: "Lên kế hoạch nội dung fanpage và LinkedIn tháng 10",
            desc: md(
              "Kế hoạch tháng 10 tập trung vào 3 trụ cột: **before/after**, **quy trình – đội ngũ** và **ưu đãi cho khách mới**.",
              "",
              "- Fanpage: 3 bài/tuần (T2, T4, T6)",
              "- LinkedIn: 2 bài/tuần, ưu tiên nội dung cho agency BĐS Úc/Mỹ",
              "- Reels: 1 video/tuần, dưới 30 giây",
              "- Dịp đặc biệt: ra mắt website mới (15/10), 20/10",
              "",
              "File lịch đăng chi tiết đính kèm, mọi người góp ý trực tiếp dưới task nhé."
            ),
            priority: "high",
            creator: "an",
            assignees: ["an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 16,
            files: [{ name: "ke-hoach-noi-dung-thang-10.xlsx", hint: "lịch đăng bài fanpage, LinkedIn, reels tháng 10 theo tuần" }],
            subtasks: [
              { title: "Tổng hợp số liệu tương tác tháng 9", assignees: ["hanh"], status: "Đã đăng" },
              { title: "Chốt chủ đề theo tuần với chị Linh", assignees: ["an"], status: "Đã đăng" },
              { title: "Gắn ngày đăng vào lịch Nesso Work", assignees: ["an"], status: "Đã đăng" }
            ],
            comments: [
              {
                by: "linh",
                at: 0.3,
                text: "Tuần 15/10 dồn bài ra mắt website nhé An, đừng để bài before/after trùng ngày đó.",
                replies: [{ by: "an", at: 0.4, text: "Dạ em dời bài before/after sang thứ Năm 16/10 rồi chị." }]
              },
              {
                by: "boss",
                at: 1.2,
                text: "Kế hoạch ổn. Thêm 1 bài giới thiệu đội QC, khách nước ngoài rất quan tâm khâu kiểm soát chất lượng.",
                replies: [{ by: "an", at: 1.3, text: "Dạ anh, em thêm vào tuần 3 ạ 👍" }]
              }
            ]
          },
          {
            title: "Bài before/after HDR phòng khách – tuần 41",
            priority: "normal",
            assignees: ["an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 5,
            comments: [
              {
                by: "an",
                at: 0.2,
                text: "Ảnh ghép xong rồi, chị @{linh} duyệt giúp em trước 15h nhé.",
                files: [{ name: "before-after-hdr-phong-khach.jpg", hint: "before/after HDR phòng khách, cửa sổ rõ cảnh ngoài" }],
                replies: [
                  {
                    by: "linh",
                    at: 0.4,
                    text: "Ổn rồi em. Caption thêm câu 'blended from 5 brackets' cho dân trong nghề dễ hiểu."
                  },
                  {
                    by: "an",
                    at: 0.5,
                    text: "Dạ, em đăng lúc 19h tối nay.",
                    edited: "Dạ, em lên lịch đăng 19h tối nay luôn ạ."
                  }
                ]
              }
            ]
          },
          {
            title: "Viết caption song ngữ Anh–Việt cho 8 bài before/after tháng 10",
            desc: md(
              "Caption ngắn, giọng chuyên nghiệp, không nhắc tên khách.",
              "",
              "[x] Bài 1–2: HDR phòng khách, bếp",
              "[x] Bài 3: sky replacement",
              "[ ] Bài 4–5: virtual staging",
              "[ ] Bài 6: day-to-dusk",
              "[ ] Bài 7–8: object removal, cắt nền sản phẩm"
            ),
            priority: "normal",
            assignees: ["acc2", "an"],
            status: "Đang viết",
            due: "none",
            createdDaysAgo: 4
          },
          {
            title: "Reels 30 giây: từ 5 bracket đến ảnh HDR hoàn thiện",
            desc: md(
              "Ý tưởng: tua nhanh màn hình thao tác blend, kết bằng slider before/after. Nhạc không lời, có phụ đề tiếng Anh.",
              "",
              "@{nv03} và @{nv07} giúp chọn 1 bộ bracket đẹp (khách đã đồng ý cho dùng) và quay màn hình lúc làm nhé."
            ),
            priority: "normal",
            creator: "an",
            assignees: ["an", "nv03", "nv07"],
            status: "Đang thiết kế",
            due: "next_week",
            createdDaysAgo: 8,
            subtasks: [
              { title: "Chọn bộ bracket và quay màn hình thao tác blend", assignees: ["nv03"], status: "Đã đăng" },
              { title: "Quay thêm đoạn kéo cửa sổ và cân màu", assignees: ["nv07"], status: "Đang thiết kế" },
              { title: "Dựng video, chèn nhạc và phụ đề tiếng Anh", assignees: ["an"], status: "Ý tưởng", due: "next_week" }
            ],
            comments: [
              {
                by: "nv03",
                at: 3.1,
                text: "Em quay xong đoạn blend rồi, file dài 4 phút, để trong thư mục Marketing/Reels trên NAS ạ.",
                replies: [{ by: "an", at: 3.3, text: "Cảm ơn em nha, mình cắt còn khoảng 20 giây thôi." }]
              },
              {
                by: "nv07",
                at: 4.5,
                text: "Đoạn cân màu em quay lại vì lúc nãy bị lộ tên thư mục khách 😅",
                replies: [{ by: "an", at: 4.6, text: "Chuẩn luôn, nhớ thu gọn panel Layers có tên file nữa nha." }]
              },
              { by: "linh", at: 6.2, text: "Reels này đăng cùng tuần ra mắt website được không An?" }
            ]
          },
          {
            title: "Bài LinkedIn: 5 lỗi khi chụp ảnh BĐS khiến hậu kỳ tốn thời gian",
            desc: md(
              "Dàn ý (giọng chia sẻ, không chê khách):",
              "1. Bracket thiếu, chênh sáng không đủ",
              "2. Máy ảnh xê dịch giữa các tấm",
              "3. Đèn trong phòng lúc bật lúc tắt",
              "4. Góc quá rộng, đường dọc bị nghiêng",
              "5. Gương phản chiếu người chụp",
              "",
              "Kết bài: mời agency gửi 10 ảnh dùng thử."
            ),
            priority: "normal",
            assignees: ["acc1", "an"],
            status: "Đang viết",
            due: "none",
            createdDaysAgo: 3
          },
          {
            title: "Bài before/after day-to-dusk căn hộ view sông",
            priority: "normal",
            assignees: ["an", "nv05", "nv12"],
            status: "Chờ duyệt",
            due: "tomorrow",
            createdDaysAgo: 4,
            comments: [
              {
                by: "nv05",
                at: 1.0,
                text: "Em gửi 3 phương án trời hoàng hôn, mọi người chọn giúp em bản nào tự nhiên nhất nha.",
                replies: [
                  { by: "nv12", at: 1.1, text: "Bản 2 đẹp nhất, nhưng đèn trong phòng hơi vàng quá." },
                  {
                    by: "an",
                    at: 1.4,
                    text: "Chốt bản 2, em giảm đèn chút rồi gửi lại nhé. Chị Linh duyệt xong là lên lịch đăng thứ Hai."
                  }
                ]
              }
            ]
          },
          {
            title: "Đăng bài chúc mừng Quốc khánh 2/9 trên fanpage",
            priority: "low",
            assignees: ["hanh", "an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 40
          },
          {
            title: "Series 'Một ngày ở studio hậu kỳ' – 4 tập giới thiệu đội ngũ",
            desc: md(
              "Ý tưởng từ buổi họp marketing: mỗi tập 1 phút, quay ca sáng – ca chiều – ca đêm – đội QC.",
              "",
              "> Hỏi ý kiến mọi người trước khi quay, ai không muốn lên hình thì chỉ quay tay và màn hình thôi."
            ),
            priority: "low",
            creator: "linh",
            assignees: [],
            status: "Ý tưởng",
            due: "none",
            createdDaysAgo: 12
          },
          {
            title: "Bài recap team building Vũng Tàu kèm album ảnh",
            priority: "normal",
            assignees: ["hanh", "an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 12,
            comments: [
              {
                by: "hanh",
                at: 0.2,
                text: "Em lọc được 42 ảnh đẹp rồi, mọi người xem giúp em album này nhé.",
                replies: [{ by: "an", at: 0.3, text: "Bỏ bớt mấy tấm nhắm mắt nha Hạnh 😂 còn khoảng 30 tấm là đẹp." }]
              },
              {
                by: "boss",
                at: 0.9,
                text: "Bài viết tốt, ảnh cả team vui vẻ. Ghim lên đầu trang 1 tuần nhé.",
                replies: [{ by: "hanh", at: 1.0, text: "Dạ em ghim rồi ạ, cảm ơn anh!" }]
              },
              { by: "linh", at: 1.1, text: "Hạnh làm bài này ngay trước khi kết thúc thực tập, quá xịn 👏" }
            ]
          },
          {
            title: "Bài before/after virtual staging phòng ngủ trống",
            priority: "normal",
            assignees: ["an", "nv08", "nv14"],
            status: "Đang thiết kế",
            due: "week",
            createdDaysAgo: 5
          },
          {
            title: "Mẫu trả lời nhanh tin nhắn fanpage (Anh/Việt)",
            priority: "normal",
            assignees: ["acc2"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 22
          },
          {
            title: "Bài đăng tôn vinh chị em nhân dịp 20/10",
            desc: md(
              "Năm nay làm khác đi: mỗi chị em chọn 1 tấm ảnh mình retouch tâm đắc nhất, ghép thành bộ ảnh **Những đôi tay khéo léo**.",
              "",
              "- Không cần lộ mặt nếu không muốn",
              "- Đăng sáng 20/10 trên fanpage và LinkedIn"
            ),
            priority: "high",
            creator: "boss",
            assignees: ["an"],
            status: "Ý tưởng",
            due: "next_week",
            createdDaysAgo: 2,
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "@{an} lên ý tưởng giúp anh, chi phí in ảnh để @{admin} lo.",
                replies: [{ by: "an", at: 0.4, text: "Dạ anh, chiều mai em gửi moodboard ạ." }]
              },
              {
                by: "an",
                at: 1.6,
                text: "Em gửi moodboard 2 hướng rồi, @{boss} xem giúp em chọn hướng nào ạ.",
                replies: [{ by: "boss", at: 1.9, text: "Hướng 2, tông ấm. Nhớ hỏi trước chị em nào muốn tham gia." }]
              }
            ]
          },
          {
            title: "Bài Trung thu 'Đêm trăng của team hậu kỳ'",
            priority: "normal",
            assignees: ["hanh", "an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 18
          },
          {
            title: "Chuyển lịch đăng bài từ Excel sang Nesso Work",
            desc: md(
              "Từ 25/8 công ty dùng Nesso Work, lịch đăng bài cũng chuyển hết lên đây.",
              "",
              "[x] Tạo list 'Nội dung mạng xã hội'",
              "[x] Nhập 24 bài đã lên lịch tháng 9",
              "[x] Hướng dẫn Hạnh cập nhật trạng thái",
              "[x] Đưa file Excel cũ vào thư mục lưu trữ"
            ),
            priority: "normal",
            assignees: ["an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 44,
            comments: [
              {
                by: "linh",
                at: 0.5,
                text: "Dùng thêm view lịch cho dễ nhìn nha An, Excel cũ để lưu trữ thôi.",
                replies: [{ by: "an", at: 0.6, text: "Dạ ok chị, nhìn theo lịch tiện hơn hẳn." }]
              },
              { by: "hanh", at: 1.2, text: "Em cập nhật trạng thái các bài tuần này rồi ạ." }
            ]
          },
          {
            title: "Bài so sánh sky replacement trời xám → hoàng hôn",
            priority: "low",
            assignees: ["an"],
            status: "Ý tưởng",
            due: "none",
            createdDaysAgo: 19,
            trash: true
          },
          {
            title: "Video ngắn giới thiệu dịch vụ object removal cho TikTok",
            priority: "low",
            assignees: ["an"],
            status: "Huỷ",
            due: "none",
            createdDaysAgo: 25,
            comments: [
              {
                by: "linh",
                at: 3.0,
                text: "Tạm dừng TikTok nhé, khách mình chủ yếu là agency nên tập trung LinkedIn hiệu quả hơn.",
                replies: [{ by: "an", at: 3.1, text: "Dạ, em chuyển task sang Huỷ ạ." }]
              }
            ]
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Portfolio & case study",
        description: "Bộ before/after mẫu cho website mới, hồ sơ năng lực và gửi khách tiềm năng.",
        color: "violet",
        tasks: [
          {
            title: "Chọn 20 bộ before/after HDR đẹp nhất cho gallery website mới",
            desc: md(
              "Website mới ra mắt **15/10**, gallery cần xong trước 12/10 để @{minh} kịp dựng.",
              "",
              "Tiêu chí chọn:",
              "[x] Ảnh đã được khách đồng ý cho dùng làm portfolio",
              "[x] Không lộ số nhà, biển số xe, ảnh gia đình",
              "[ ] Đủ 4 nhóm: phòng khách, bếp, phòng ngủ, ngoại thất",
              "[ ] Xuất 2 kích thước 2400px và 1200px (WebP)",
              "",
              "Thư mục gom ảnh: [Gallery website](https://nesso.example/nas/marketing/gallery-2026)"
            ),
            priority: "urgent",
            creator: "linh",
            assignees: ["an", "nv01", "nv04"],
            status: "Đang thiết kế",
            due: "tomorrow",
            createdDaysAgo: 7,
            subtasks: [
              { title: "Gom 40 bộ ứng viên từ đơn tháng 8–9", assignees: ["nv01", "nv04"], status: "Đã đăng" },
              { title: "Lọc còn 20 bộ, kiểm tra quyền sử dụng", assignees: ["an"], status: "Đang thiết kế" },
              { title: "Xuất ảnh 2 kích thước, đặt tên theo quy ước", assignees: ["nv04"], status: "Ý tưởng", due: "tomorrow" }
            ],
            comments: [
              {
                by: "nv01",
                at: 2.2,
                text: "Em gom được 26 bộ ngoại thất + phòng khách, bếp hơi ít ạ.",
                replies: [{ by: "nv04", at: 2.3, text: "Em bổ sung 8 bộ bếp từ đơn tuần cao điểm nha." }]
              },
              {
                by: "boss",
                at: 3.4,
                text: "Ưu tiên ảnh có cửa sổ nhìn ra cảnh ngoài rõ, đó là điểm mạnh của mình.",
                replies: [{ by: "an", at: 3.5, text: "Dạ anh, em đưa 5 bộ cửa sổ đẹp nhất lên đầu gallery." }]
              },
              {
                by: "minh",
                at: 6.1,
                text: "An ơi, chiều mai có ảnh chưa? Anh cần ghép vào trang gallery để test tốc độ tải.",
                replies: [{ by: "an", at: 6.3, text: "Sáng mai em gửi đợt đầu 12 bộ trước nha anh." }]
              }
            ]
          },
          {
            title: "Bộ before/after virtual staging 3 phong cách: hiện đại, Bắc Âu, tối giản",
            priority: "high",
            assignees: ["an", "nv06", "nv10"],
            status: "Đang thiết kế",
            due: "week",
            createdDaysAgo: 8,
            subtasks: [
              { title: "Phong cách hiện đại – phòng khách", assignees: ["nv06"], status: "Chờ duyệt" },
              { title: "Phong cách Bắc Âu – phòng ngủ", assignees: ["nv10"], status: "Đang thiết kế" },
              { title: "Phong cách tối giản – phòng làm việc", assignees: ["nv06", "nv10"], status: "Ý tưởng" }
            ]
          },
          {
            title: "Case study: xử lý 600 ảnh HDR gấp mùa cao điểm cho agency Úc",
            desc: md(
              "Dựa trên tuần cao điểm 14–19/9. **Không nêu tên khách**, chỉ ghi 'một agency BĐS ở Úc'.",
              "",
              "## Dàn ý",
              "1. Bối cảnh: mùa xuân bên Úc, đơn tăng gấp 3",
              "2. Cách tổ chức: thêm ca đêm, chia đơn theo nhóm, QC 2 lớp",
              "3. Kết quả: trả đúng hạn, tỉ lệ trả sửa thấp",
              "4. Bài học: chuẩn hoá màu trời, kiểm tra kéo cửa sổ",
              "",
              "Số liệu lấy từ báo cáo sản xuất, nhờ @{lead1} xác nhận lại."
            ),
            priority: "high",
            creator: "linh",
            assignees: ["acc1", "an"],
            status: "Đang viết",
            due: "week",
            createdDaysAgo: 10,
            comments: [
              {
                by: "acc1",
                at: 2.5,
                text: "Em viết xong phần 1–2, phần kết quả chờ số liệu tỉ lệ trả sửa ạ.",
                replies: [
                  {
                    by: "linh",
                    at: 2.8,
                    text: "Lấy số sau khi đã xử lý khiếu nại màu trời nhé, nói thật nhưng khéo."
                  }
                ]
              },
              {
                by: "boss",
                at: 8.6,
                text: "Case study này gửi kèm email cho agency mới được không? Anh muốn có trước ngày 15.",
                replies: [{ by: "acc1", at: 8.7, text: "Dạ được anh, em làm thêm bản PDF 2 trang." }]
              }
            ]
          },
          {
            title: "Xin phép khách dùng ảnh làm portfolio – mẫu email và danh sách",
            desc: md(
              "Mẫu email ngắn, lịch sự, cam kết làm mờ địa chỉ và không ghi tên agency.",
              "",
              "- Danh sách: 18 khách đã làm việc trên 6 tháng",
              "- Ưu tiên khách có ảnh ngoại thất đẹp",
              "- Ghi kết quả đồng ý/từ chối vào cột trạng thái"
            ),
            priority: "normal",
            assignees: ["acc1", "acc2"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 15,
            comments: [
              {
                by: "acc2",
                at: 3.0,
                text: "Đã gửi 11/18 khách, 6 khách đồng ý, 1 khách từ chối ạ.",
                edited: "Đã gửi 11/18 khách: 7 đồng ý, 1 từ chối, còn lại chưa trả lời ạ."
              },
              {
                by: "linh",
                at: 10.0,
                text: "Còn 7 khách chưa gửi, xong trong tuần này nha 2 bạn, gallery website đang chờ.",
                replies: [{ by: "acc1", at: 10.2, text: "Dạ, em gửi nốt sáng mai ạ." }]
              },
              { by: "an", at: 13.2, text: "Bên mình chốt được danh sách ảnh được phép dùng chưa ạ? Em cần lọc gallery." }
            ]
          },
          {
            title: "Làm mờ thông tin nhận diện trên ảnh mẫu (biển số, số nhà, ảnh gia đình)",
            priority: "normal",
            assignees: ["nv11", "nv13"],
            status: "Đang thiết kế",
            due: "none",
            createdDaysAgo: 5
          },
          {
            title: "Cập nhật hồ sơ năng lực bản tiếng Anh 2026",
            priority: "high",
            assignees: ["an", "linh"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 21,
            comments: [
              {
                by: "an",
                at: 5.0,
                text: "Bản nháp 12 trang xong rồi, chị @{linh} xem phần quy trình QC giúp em.",
                replies: [{ by: "linh", at: 6.5, text: "Phần QC viết lại theo checklist v2 nhé, bản cũ hết dùng rồi." }]
              },
              {
                by: "boss",
                at: 18.0,
                text: "Hồ sơ này cần gấp cho khách Nhật, tuần này chốt được không?",
                replies: [
                  { by: "linh", at: 18.2, text: "Dạ anh, em duyệt xong tối nay, mai An xuất PDF ạ." },
                  { by: "an", at: 19.5, text: "Em sửa theo góp ý rồi, đang chờ chị Linh xem lần cuối." }
                ]
              }
            ]
          },
          {
            title: "Bộ ảnh mẫu cắt nền sản phẩm cho khách Nhật dùng thử",
            desc: md(
              "Khách Nhật rất kỹ về **viền**: không răng cưa, không viền trắng, giữ bóng đổ tự nhiên.",
              "",
              "[x] 10 ảnh mỹ phẩm nền trắng",
              "[x] 5 ảnh giày có dây",
              "[ ] 5 ảnh trang sức (khó nhất)",
              "[ ] Xuất kèm file PSD giữ path",
              "",
              "Tiêu chuẩn tham khảo: [Hướng dẫn cắt nền](https://nesso.example/wiki/clipping-path-chuan)"
            ),
            priority: "urgent",
            assignees: ["an", "nv07", "nv15"],
            status: "Đang thiết kế",
            due: "today",
            createdDaysAgo: 4,
            subtasks: [
              { title: "Cắt 5 ảnh trang sức, zoom 300% kiểm tra viền", assignees: ["nv15"], status: "Đang thiết kế" },
              { title: "Đóng gói PSD + JPG gửi bên account", assignees: ["nv07"], status: "Ý tưởng", due: "today" }
            ],
            comments: [
              {
                by: "nv07",
                at: 0.8,
                text: "Ảnh giày em làm xong, dây giày em tách path riêng từng đoạn ạ.",
                files: [{ name: "mau-cat-nen-san-pham-vien-sach.png", hint: "giày cắt nền trắng, zoom viền dây giày" }],
                replies: [{ by: "an", at: 1.0, text: "Đẹp quá, viền rất sạch 👍" }]
              },
              {
                by: "acc1",
                at: 2.5,
                text: "Khách hỏi thêm có làm được bóng phản chiếu không, mình thử 2 ảnh mỹ phẩm nhé.",
                replies: [{ by: "nv15", at: 2.7, text: "Dạ em thử bóng phản chiếu trên 2 chai serum." }]
              },
              {
                by: "boss",
                at: 3.5,
                text: "Đây là khách quan trọng của quý 4. @{acc1} chậm nhất tối mai phải gửi khách nhé.",
                replies: [{ by: "acc1", at: 3.6, text: "Dạ anh, chiều mai em gửi ạ." }]
              }
            ]
          },
          {
            title: "Bộ before/after day-to-dusk 10 ảnh cho portfolio",
            priority: "normal",
            assignees: ["hanh", "an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 30
          },
          {
            title: "Chụp màn hình quy trình QC 2 lớp để đưa vào hồ sơ năng lực",
            priority: "low",
            assignees: [],
            status: "Ý tưởng",
            due: "none",
            createdDaysAgo: 12
          },
          {
            title: "Bộ before/after object removal: xoá xe, thùng rác, dây điện",
            priority: "normal",
            assignees: ["an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 22
          },
          {
            title: "Video before/after dạng slider cho trang chủ website",
            desc: md(
              "Slider kéo qua lại giữa ảnh gốc và ảnh đã xử lý, chạy mượt trên điện thoại.",
              "",
              "- Tối đa 6 cặp ảnh",
              "- Mỗi ảnh dưới 300KB (WebP)",
              "- Có nút tạm dừng tự chạy"
            ),
            priority: "high",
            assignees: ["minh", "an"],
            status: "Đang thiết kế",
            due: "week",
            createdDaysAgo: 5,
            comments: [
              {
                by: "minh",
                at: 1.5,
                text: "Anh dựng xong khung slider, chỉ thiếu ảnh thật. An gửi 6 cặp trước nhé.",
                replies: [{ by: "an", at: 1.8, text: "Em gửi 4 cặp, 2 cặp còn lại chờ khách đồng ý ạ." }]
              },
              {
                by: "minh",
                at: 3.2,
                text: "Trên iPhone kéo slider bị giật, anh đang giảm kích thước ảnh xuống.",
                edited: "Trên iPhone đời cũ kéo slider bị giật, anh đang giảm kích thước ảnh và tắt hiệu ứng bóng."
              },
              { by: "linh", at: 4.1, text: "Nhớ test cả mạng 4G nha anh Minh, khách Úc hay mở bằng điện thoại." }
            ]
          },
          {
            title: "Tổng hợp feedback tốt của khách làm testimonial (ẩn danh)",
            priority: "normal",
            assignees: ["acc2"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 25
          },
          {
            title: "Bộ before/after chân dung cưới – retouch da tự nhiên",
            priority: "normal",
            assignees: ["hanh", "an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 28
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Quảng cáo & chiến dịch",
        description: "Google Ads thử nghiệm, email marketing cho agency mới, landing page tiếng Nhật.",
        color: "orange",
        tasks: [
          {
            title: "Thiết lập chiến dịch Google Ads thử nghiệm cho 'real estate photo editing'",
            desc: md(
              "Chạy thử 4 tuần, nhắm thị trường Úc, mức chi theo phương án anh duyệt ở task bên cạnh.",
              "",
              "[x] Tạo tài khoản quảng cáo của công ty",
              "[ ] Viết 3 mẫu quảng cáo",
              "[ ] Gắn chuyển đổi: form gửi ảnh dùng thử",
              "[ ] Loại trừ từ khoá 'free', 'job', 'course'"
            ),
            priority: "high",
            assignees: ["an", "acc1"],
            status: "Đang viết",
            due: "week",
            createdDaysAgo: 5,
            subtasks: [
              { title: "Viết 3 mẫu quảng cáo tiếng Anh", assignees: ["acc1"], status: "Đang viết" },
              { title: "Thiết kế ảnh hiển thị 3 kích thước", assignees: ["an"], status: "Ý tưởng" },
              { title: "Gắn mã chuyển đổi vào form dùng thử", assignees: ["minh"], status: "Ý tưởng" }
            ],
            comments: [
              {
                by: "acc1",
                at: 1.5,
                text: md(
                  "Em viết 3 mẫu headline rồi, mọi người vote giúp em nhé:",
                  "- Real Estate Photo Editing in 12h",
                  "- HDR Blending That Looks Natural",
                  "- Try 10 Photos Free"
                ),
                replies: [
                  { by: "an", at: 1.7, text: "Mẫu 2 hay nhất, mẫu 3 dễ bị click rác." },
                  { by: "linh", at: 2.0, text: "Chạy song song mẫu 1 và 2 để so sánh nhé." }
                ]
              }
            ]
          },
          {
            title: "Duyệt ngân sách Google Ads thử nghiệm tháng 10–11",
            desc: md(
              "Đề xuất 2 phương án để anh chọn:",
              "- **Phương án A**: chạy 2 thị trường Úc + Mỹ, 4 tuần",
              "- **Phương án B**: chỉ chạy Úc, 6 tuần, tập trung mùa xuân",
              "",
              "Chi tiết chi phí em gửi riêng trong nhóm tài chính."
            ),
            priority: "high",
            creator: "an",
            assignees: ["boss"],
            status: "Chờ duyệt",
            due: "week",
            createdDaysAgo: 3,
            comments: [
              { by: "an", at: 0.2, text: "@{boss} anh xem giúp em 2 phương án trong tuần này nhé ạ." },
              {
                by: "boss",
                at: 1.1,
                text: "Anh nghiêng về phương án B. Mùa xuân bên Úc đang lên, đánh tập trung sẽ dễ đo hơn.",
                replies: [
                  { by: "linh", at: 1.3, text: "Em cũng thấy B hợp lý, đỡ dàn trải." },
                  { by: "an", at: 1.4, text: "Dạ, vậy em sửa lại kế hoạch theo phương án B." }
                ]
              },
              {
                by: "acc1",
                at: 2.7,
                text: "@{boss} anh ơi, nếu chốt B thì em cần anh duyệt chính thức để bật chiến dịch sáng thứ Hai ạ."
              }
            ]
          },
          {
            title: "Nghiên cứu từ khoá và đối thủ thị trường Úc, Mỹ",
            desc: md(
              "Tổng hợp 60 từ khoá, chia 3 nhóm: HDR/blending, virtual staging, dịch vụ chỉnh ảnh nói chung.",
              "Ghi chú đối thủ hay dùng thông điệp gì (giá rẻ, nhanh, dùng thử)."
            ),
            priority: "normal",
            assignees: ["hanh", "acc2"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 21,
            files: [{ name: "tu-khoa-google-ads-uc-my.xlsx", hint: "bảng từ khoá, lượng tìm kiếm ước tính, mức cạnh tranh" }]
          },
          {
            title: "Chuỗi 3 email giới thiệu dịch vụ cho agency BĐS mới",
            desc: md(
              "## Chuỗi email",
              "1. Ngày 1: giới thiệu ngắn + 3 cặp before/after",
              "2. Ngày 4: case study mùa cao điểm",
              "3. Ngày 9: mời gửi 10 ảnh dùng thử",
              "",
              "Viết ngắn, dưới 120 chữ mỗi email. Gửi bằng tên người phụ trách bên account, không gửi từ hộp thư chung."
            ),
            priority: "high",
            assignees: ["acc1", "an"],
            status: "Đang viết",
            due: "next_week",
            createdDaysAgo: 7,
            subtasks: [
              { title: "Email 1 – giới thiệu + before/after", assignees: ["acc1"], status: "Chờ duyệt" },
              { title: "Email 2 – case study", assignees: ["acc1"], status: "Đang viết" },
              { title: "Email 3 – mời dùng thử", assignees: ["acc1", "an"], status: "Ý tưởng" }
            ],
            comments: [
              {
                by: "acc1",
                at: 2.0,
                text: "Email 1 xong rồi ạ, chị @{linh} xem giúp em giọng văn có cứng quá không.",
                replies: [
                  { by: "linh", at: 2.4, text: "Bỏ câu 'we are the best' đi em, nghe quảng cáo quá. Còn lại ổn." }
                ]
              },
              {
                by: "an",
                at: 4.0,
                text: "Ảnh before/after trong email em nén còn 180KB/ảnh, không lo bị vào spam.",
                replies: [{ by: "acc1", at: 4.1, text: "Cảm ơn nha 🙏" }]
              }
            ]
          },
          {
            title: "Danh sách 150 agency BĐS tiềm năng để gửi email",
            priority: "normal",
            assignees: ["acc2"],
            status: "Đang viết",
            due: "none",
            createdDaysAgo: 12
          },
          {
            title: "Landing page tiếng Nhật cho khách thử nghiệm cắt nền sản phẩm",
            desc: md(
              "Khách Nhật đang dùng thử dịch vụ cắt nền sản phẩm. Cần 1 trang giới thiệu riêng bằng tiếng Nhật để gửi kèm báo giá.",
              "",
              "[x] Chốt bố cục: hero, before/after, quy trình, tiêu chuẩn viền, form liên hệ",
              "[ ] Nội dung tiếng Nhật (chờ bản dịch)",
              "[ ] Ảnh mẫu từ bộ cắt nền mới",
              "[ ] Kiểm tra hiển thị trên điện thoại",
              "",
              "Bản nháp: [Landing JP](https://nesso.example/jp-preview)"
            ),
            priority: "urgent",
            creator: "boss",
            assignees: ["minh", "an"],
            status: "Đang thiết kế",
            due: "week",
            createdDaysAgo: 4,
            subtasks: [
              { title: "Thiết kế giao diện desktop + mobile", assignees: ["an"], status: "Chờ duyệt" },
              { title: "Dựng trang và form liên hệ", assignees: ["minh"], status: "Đang thiết kế" },
              { title: "Gắn ảnh mẫu cắt nền và bản dịch", assignees: ["minh", "an"], status: "Ý tưởng", due: "week" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Trang này phải gọn, sạch, đúng gu khách Nhật: ít chữ, nhiều khoảng trắng. @{an} @{minh} ưu tiên làm trước giúp anh.",
                replies: [{ by: "minh", at: 0.3, text: "Dạ anh, em làm song song, gallery website gần xong rồi." }]
              },
              {
                by: "an",
                at: 1.5,
                text: "Em gửi 2 bản thiết kế, bản B dùng trắng – xám nhạt theo nhận diện mới ạ.",
                replies: [{ by: "boss", at: 1.8, text: "Bản B. Font tiếng Nhật chọn loại mảnh thôi." }]
              },
              {
                by: "minh",
                at: 3.3,
                text: "Form liên hệ chạy ổn rồi. Còn thiếu nội dung tiếng Nhật, đang chờ task dịch.",
                replies: [{ by: "boss", at: 3.4, text: "@{acc1} bản dịch tới đâu rồi em?" }]
              }
            ]
          },
          {
            title: "Dịch nội dung landing page sang tiếng Nhật (cộng tác viên ngoài)",
            priority: "urgent",
            assignees: ["acc1"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 7,
            comments: [
              { by: "acc1", at: 3.0, text: "Cộng tác viên hẹn gửi bản dịch thứ Năm, em đã nhắc lại rồi ạ." },
              {
                by: "acc1",
                at: 6.4,
                text: "Đã nhận bản dịch, em nhờ người đọc lại thuật ngữ 'clipping path' cho chuẩn rồi gửi anh @{minh} ạ.",
                replies: [{ by: "minh", at: 6.6, text: "Ok em, có là anh gắn vào luôn." }]
              }
            ]
          },
          {
            title: "Mẫu email chúc mừng Trung thu gửi khách quốc tế",
            priority: "normal",
            assignees: ["hanh", "an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 19
          },
          {
            title: "Gói dùng thử 10 ảnh miễn phí cho khách mới quý 4",
            desc: md(
              "Đề xuất: khách mới gửi tối đa 10 ảnh, trả trong 24h, không cần thanh toán trước.",
              "Cần thống nhất với sản xuất để không ảnh hưởng đơn chính."
            ),
            priority: "normal",
            creator: "linh",
            assignees: [],
            status: "Ý tưởng",
            due: "none",
            createdDaysAgo: 8,
            comments: [
              {
                by: "boss",
                at: 1.0,
                text: "Ý tưởng tốt, nhưng giới hạn 1 lần cho mỗi công ty, tránh bị lợi dụng.",
                replies: [
                  { by: "linh", at: 1.2, text: "Dạ anh, em thêm điều kiện và bàn với @{lead1} về năng lực ca." }
                ]
              },
              {
                by: "acc2",
                at: 2.0,
                text: "Em đề xuất ghi rõ 'ảnh dùng thử có watermark nhẹ' để khách không lấy dùng luôn ạ."
              }
            ]
          },
          {
            title: "Báo cáo hiệu quả email marketing tháng 9",
            priority: "normal",
            assignees: ["acc2"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 10,
            files: [
              { name: "bao-cao-email-marketing-thang-9.xlsx", hint: "tỉ lệ mở, tỉ lệ click, số khách gửi ảnh dùng thử theo tuần" }
            ]
          },
          {
            title: "Gắn UTM cho link trên fanpage, email và LinkedIn",
            priority: "normal",
            assignees: ["minh"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 9
          },
          {
            title: "Chạy quảng cáo Facebook tuyển cộng tác viên retouch",
            priority: "normal",
            assignees: ["an"],
            status: "Huỷ",
            due: "none",
            createdDaysAgo: 16
          },
          {
            title: "Webinar giới thiệu quy trình hậu kỳ cho agency Úc",
            priority: "low",
            assignees: [],
            status: "Ý tưởng",
            due: "later",
            createdDaysAgo: 2
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Sự kiện & thương hiệu",
        description: "Bộ nhận diện, đồng phục, quà khách và các dịp lễ trong năm.",
        color: "rose",
        tasks: [
          {
            title: "Duyệt bộ nhận diện thương hiệu mới (logo, bảng màu, font chữ)",
            desc: md(
              "Phương án 3 đã chỉnh theo góp ý buổi họp 22/9:",
              "- Logo bỏ hiệu ứng gradient, chỉ còn 2 màu",
              "- Màu chính xanh navy, màu phụ cam đất",
              "- Font tiêu đề mới, hỗ trợ tiếng Việt và tiếng Nhật",
              "",
              "Sau khi anh duyệt sẽ áp dụng cho website mới (15/10), áo đồng phục và hồ sơ năng lực."
            ),
            priority: "urgent",
            creator: "an",
            assignees: ["boss"],
            status: "Chờ duyệt",
            due: "overdue",
            createdDaysAgo: 16,
            files: [{ name: "bo-nhan-dien-phuong-an-3.pdf", hint: "logo, bảng màu, font chữ, ví dụ áp dụng danh thiếp và website" }],
            comments: [
              { by: "linh", at: 1.0, text: "Em thấy phương án 3 ổn rồi, chờ anh chốt thôi ạ." },
              {
                by: "boss",
                at: 5.0,
                text: "Logo ổn. Màu cam đất hơi trầm khi in lên áo, An thử thêm 1 tông sáng hơn.",
                replies: [{ by: "an", at: 6.0, text: "Dạ, em gửi thêm 2 tông cam trong file mới ạ." }]
              },
              {
                by: "an",
                at: 9.5,
                text: "@{boss} em đã cập nhật file, anh xem giúp em để kịp in áo và lên website ạ.",
                edited: "@{boss} em đã cập nhật file (bản 3.1), anh xem giúp em để kịp in áo và lên website ạ."
              },
              {
                by: "minh",
                at: 15.3,
                text: "Website cần chốt màu trước thứ Hai, không thì anh dùng tạm bảng màu cũ nhé."
              },
              {
                by: "an",
                at: 15.9,
                text: "@{boss} anh ơi, nhận diện mới vẫn đang chờ anh duyệt, website và áo đồng phục đều cần chốt màu ạ 🙏"
              }
            ]
          },
          {
            title: "Thiết kế bộ nhận diện mới – phương án 3",
            priority: "high",
            assignees: ["an", "hanh"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 30
          },
          {
            title: "Đặt may áo đồng phục polo mới (khoảng 60 áo)",
            priority: "normal",
            assignees: ["an"],
            status: "Đang thiết kế",
            due: "none",
            createdDaysAgo: 9,
            subtasks: [
              { title: "Chốt mẫu áo và vị trí in logo", assignees: ["an"], status: "Đang thiết kế" },
              { title: "Thu size toàn công ty", assignees: ["admin"] },
              { title: "Lấy báo giá 2 xưởng may", assignees: ["admin"] }
            ],
            comments: [
              { by: "admin", at: 1.0, text: "Em gửi form thu size vào kênh chung rồi, mọi người điền trước thứ Tư nhé." },
              {
                by: "an",
                at: 2.5,
                text: "Mẫu áo chờ chốt màu nhận diện mới, em làm sẵn 2 bản navy và trắng.",
                files: [{ name: "mau-ao-dong-phuc-polo.png", hint: "mockup áo polo navy và trắng, logo ngực trái" }],
                replies: [{ by: "linh", at: 2.9, text: "Bản navy đẹp, mặc ca đêm cũng đỡ lộ bẩn 😄" }]
              },
              { by: "boss", at: 6.0, text: "Đặt dư 10 áo cho các bạn mới sắp vào nhé." }
            ]
          },
          {
            title: "Quà Trung thu cho khách và đối tác thân thiết",
            priority: "high",
            assignees: ["an", "acc1"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 26,
            subtasks: [
              { title: "Thiệp điện tử Trung thu gửi khách nước ngoài", assignees: ["an"], status: "Đã đăng" },
              { title: "Hộp bánh cho đối tác in ấn và văn phòng cho thuê", assignees: ["acc1"], status: "Đã đăng" }
            ],
            comments: [
              { by: "acc1", at: 2.0, text: "Danh sách nhận quà 14 đối tác, em chốt rồi ạ." },
              {
                by: "boss",
                at: 11.5,
                text: "Khách bên Úc trả lời thiệp rất vui, cảm ơn team nhé 👏",
                replies: [{ by: "an", at: 11.6, text: "Dạ, em lưu lại mẫu thiệp để năm sau dùng tiếp ạ." }]
              }
            ]
          },
          {
            title: "Duyệt thiết kế thiệp và quà Trung thu gửi khách",
            priority: "normal",
            creator: "an",
            assignees: ["boss"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 24
          },
          {
            title: "Backdrop và standee cho tiệc Trung thu 25/9 tại văn phòng",
            priority: "normal",
            assignees: ["hanh", "an"],
            status: "Đã đăng",
            due: "past",
            createdDaysAgo: 19
          },
          {
            title: "Trang trí văn phòng và góc chụp ảnh ngày 20/10",
            desc: "Góc chụp ảnh nhỏ ở sảnh, hoa tươi trên bàn từng chị em. Phối hợp với bên nhân sự (quà 20/10) để không trùng ý tưởng.",
            priority: "normal",
            assignees: ["an"],
            status: "Ý tưởng",
            due: "next_week",
            createdDaysAgo: 1
          },
          {
            title: "Video giới thiệu công ty 90 giây – ghi hình lời chào của giám đốc",
            desc: md(
              "Kịch bản 90 giây cho trang chủ website và LinkedIn:",
              "1. Lời chào của giám đốc (15 giây, tiếng Anh)",
              "2. Cảnh làm việc ca sáng – ca đêm",
              "3. Before/after nhanh",
              "4. Kêu gọi gửi ảnh dùng thử",
              "",
              "@{boss} anh chọn giúp em 1 buổi sáng để ghi hình phần lời chào nhé."
            ),
            priority: "high",
            creator: "an",
            assignees: ["boss", "an"],
            status: "Đang viết",
            due: "week",
            createdDaysAgo: 8,
            subtasks: [
              { title: "Viết kịch bản lời chào tiếng Anh", assignees: ["an"], status: "Chờ duyệt" },
              { title: "Ghi hình lời chào tại phòng họp", assignees: ["boss", "an"], status: "Ý tưởng", due: "week" }
            ],
            comments: [
              {
                by: "boss",
                at: 1.0,
                text: "Thứ Ba tuần sau 9h nhé. Kịch bản đừng dài quá, anh nói tiếng Anh tự nhiên thôi.",
                replies: [{ by: "an", at: 1.2, text: "Dạ anh, em rút còn 4 câu ạ." }]
              },
              { by: "an", at: 7.6, text: "Kịch bản bản cuối em để trong mô tả rồi, @{boss} xem trước giúp em ạ." },
              { by: "linh", at: 7.8, text: "Ghi hình xong nhớ quay thêm cảnh team QC nha An." }
            ]
          },
          {
            title: "Bộ hình nền máy tính và chữ ký email theo nhận diện mới",
            priority: "low",
            assignees: ["an", "minh"],
            status: "Ý tưởng",
            due: "later",
            createdDaysAgo: 3
          },
          {
            title: "Banner fanpage tháng 10 theo nhận diện mới",
            priority: "normal",
            assignees: ["an"],
            status: "Chờ duyệt",
            due: "today",
            createdDaysAgo: 3,
            files: [{ name: "banner-fanpage-thang-10.png", hint: "ảnh bìa fanpage tháng 10, tông navy, before/after HDR" }],
            comments: [
              {
                by: "an",
                at: 0.5,
                text: "Banner làm theo màu mới, nếu nhận diện chưa duyệt kịp thì em có bản dự phòng màu cũ ạ."
              },
              {
                by: "linh",
                at: 2.2,
                text: "Dùng bản màu mới luôn, đổi cùng lúc với website cho đồng bộ.",
                replies: [{ by: "an", at: 2.4, text: "Dạ, anh duyệt nhận diện là em thay ngay." }]
              }
            ]
          },
          {
            title: "Bảng tên và danh thiếp cho nhân viên mới",
            priority: "low",
            assignees: [],
            status: "Ý tưởng",
            due: "later",
            createdDaysAgo: 2
          },
          {
            title: "In lịch để bàn 2027 làm quà cuối năm cho đối tác",
            desc: "Mỗi tháng 1 cặp before/after đẹp nhất của năm. In khoảng 80 cuốn, gửi đối tác trong nước và mang theo khi gặp khách.",
            priority: "normal",
            creator: "boss",
            assignees: [],
            status: "Ý tưởng",
            due: "later",
            createdDaysAgo: 4
          },
          {
            title: "Banner gian hàng hội chợ nhiếp ảnh (không tham gia nữa)",
            priority: "low",
            assignees: ["an"],
            status: "Ý tưởng",
            due: "none",
            createdDaysAgo: 30,
            trash: true
          }
        ]
      }
    ]
  },

  // ================================================================================================
  // HR — Tuyển dụng & Đào tạo
  // ================================================================================================
  {
    key: "HR",
    name: "Tuyển dụng & Đào tạo",
    description: "Tuyển retoucher, đào tạo nội bộ, onboarding nhân viên mới, đánh giá và phúc lợi.",
    icon: "users",
    color: "amber",
    visibility: "public",
    owner: "admin",
    members: {
      admin: "manage",
      boss: "manage",
      linh: "manage",
      lead1: "submit",
      lead2: "submit",
      khoa: "submit",
      an: "view"
    },
    workflow: hrWorkflow,
    createdOn: "2026-08-27",
    lists: [
      // ---------------------------------------------------------------------------------------------
      {
        name: "Tuyển dụng retoucher",
        description: "Pipeline tuyển retoucher và trưởng nhóm. Ứng viên ghi theo mã số, không ghi họ tên.",
        color: "violet",
        workflow: hiringWorkflow,
        tasks: [
          {
            title: "Đăng tin tuyển 6 retoucher đợt tháng 10",
            desc: md(
              "Mục tiêu: **6 retoucher** (4 HDR/BĐS, 2 cắt nền sản phẩm), đi làm trước 1/11.",
              "",
              "- Yêu cầu: thành thạo Photoshop, bài test đạt từ 7/10",
              "- Ưu tiên làm được ca đêm",
              "- Hạn nhận CV: 20/10",
              "",
              "JD đính kèm, banner nhờ @{an} thiết kế."
            ),
            priority: "high",
            creator: "boss",
            assignees: ["admin"],
            status: "Nhận CV",
            due: "next_week",
            createdDaysAgo: 5,
            files: [{ name: "jd-retoucher-hdr.docx", hint: "mô tả công việc retoucher HDR bất động sản" }],
            subtasks: [
              { title: "Đăng tin lên 3 trang tuyển dụng và fanpage", assignees: ["admin"] },
              { title: "Nhờ nhân viên giới thiệu người quen (có thưởng giới thiệu)", assignees: ["lead1", "lead2"] }
            ],
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Đợt này cần người vào được việc nhanh, bài test làm kỹ giúp anh. Không cần đông, cần đúng người.",
                replies: [
                  { by: "admin", at: 0.3, text: "Dạ anh, em đã phối hợp với anh @{khoa} soạn bài test rồi ạ." }
                ]
              },
              { by: "admin", at: 1.0, text: "Ngày đầu đã nhận 34 CV, em đang lọc đợt 1 ạ." },
              {
                by: "lead1",
                at: 3.1,
                text: "Nhóm A có 2 bạn giới thiệu người quen, đã gửi CV qua bên nhân sự rồi nhé.",
                replies: [{ by: "admin", at: 3.2, text: "Đã nhận, cảm ơn nhé 🙏" }]
              }
            ]
          },
          {
            title: "Lọc CV đợt 1 – 34 hồ sơ retoucher",
            priority: "high",
            assignees: ["admin", "lead1"],
            status: "Phỏng vấn",
            due: "overdue",
            createdDaysAgo: 5,
            comments: [
              { by: "admin", at: 1.2, text: "Đã lọc 34 → 15 hồ sơ có portfolio, đang gửi lịch phỏng vấn ạ." },
              {
                by: "lead1",
                at: 2.0,
                text: "Mình xem portfolio 15 bạn rồi, 9 bạn đủ để làm bài test.",
                replies: [{ by: "admin", at: 2.2, text: "Ok, em gửi bài test cho 9 bạn trong chiều nay." }]
              },
              {
                by: "linh",
                at: 4.4,
                text: "Task này quá hạn rồi, các bạn đã có lịch thì tách task riêng rồi đóng task lọc CV nhé."
              }
            ]
          },
          {
            title: "Hoàn thiện bài test tay nghề HDR và sky replacement cho đợt tháng 10",
            desc: md(
              "Bài test 3 tiếng, làm tại văn phòng hoặc online có giám sát.",
              "",
              "[x] 1 bộ 5 bracket phòng khách nhiều cửa sổ",
              "[x] 1 ảnh ngoại thất trời xám cần thay trời",
              "[x] Bảng chấm điểm: viền cửa sổ, màu trắng tường, đường thẳng, màu trời tự nhiên",
              "[ ] Đáp án mẫu để so sánh",
              "[ ] Bản test online cho ứng viên ở xa"
            ),
            priority: "high",
            assignees: ["khoa", "lead1"],
            status: "Làm bài test",
            due: "tomorrow",
            createdDaysAgo: 7,
            files: [{ name: "de-bai-test-retoucher.pdf", hint: "đề bài test tay nghề retoucher HDR và sky replacement" }],
            subtasks: [
              { title: "Chuẩn bị bộ ảnh test (đã xin phép dùng)", assignees: ["lead1"] },
              { title: "Làm đáp án mẫu để so sánh", assignees: ["khoa"], due: "tomorrow" }
            ],
            comments: [
              {
                by: "khoa",
                at: 1.0,
                text: "Bảng chấm mình làm theo checklist QC v2, đạt từ 7/10 trở lên.",
                replies: [
                  { by: "lead1", at: 1.2, text: "Thêm tiêu chí thời gian hoàn thành nữa anh, ca đêm cần làm nhanh." },
                  { by: "khoa", at: 1.3, text: "Ok, thêm vào rồi." }
                ]
              }
            ]
          },
          {
            title: "Ứng viên retoucher HDR #07 – bài test sky replacement",
            priority: "normal",
            assignees: ["khoa"],
            status: "Làm bài test",
            due: "today",
            createdDaysAgo: 3,
            comments: [
              {
                by: "khoa",
                at: 1.5,
                text: "Phần HDR ổn, viền cửa sổ sạch. Phần thay trời màu hơi xanh gắt, giống lỗi khách Úc phàn nàn hồi tháng 9.",
                files: [{ name: "bai-test-ung-vien-07-sky.jpg", hint: "bài test thay trời, màu trời hơi xanh gắt" }],
                replies: [{ by: "lead1", at: 1.7, text: "Lỗi này đào tạo được, cho làm lại phần trời thử xem." }]
              },
              { by: "admin", at: 2.0, text: "Em hẹn bạn làm lại phần trời sáng thứ Bảy ạ." },
              { by: "khoa", at: 3.1, text: "Đang chấm lại, chiều nay có kết quả." }
            ]
          },
          {
            title: "Ứng viên retoucher #03 – 2 năm kinh nghiệm virtual staging",
            desc: md(
              "Tóm tắt:",
              "- Bài test: 8.5/10, mạnh về bóng đổ và phối cảnh",
              "- Làm được ca chiều, có thể hỗ trợ ca đêm cuối tuần",
              "- Dự kiến đi làm: 19/10"
            ),
            priority: "high",
            assignees: ["admin"],
            status: "Đề nghị",
            due: "week",
            createdDaysAgo: 4,
            comments: [
              {
                by: "admin",
                at: 1.0,
                text: "@{boss} anh duyệt mức đề nghị giúp em, chi tiết em gửi trong nhóm tài chính ạ.",
                replies: [{ by: "boss", at: 1.5, text: "Duyệt. Bạn này giỏi staging, sau này cho kèm luôn nhóm mới." }]
              },
              {
                by: "linh",
                at: 2.0,
                text: "Gửi thư mời làm việc sớm nhé, đừng để bên khác lấy mất 😄",
                replies: [{ by: "admin", at: 2.1, text: "Dạ chị, em gửi chiều nay." }]
              },
              { by: "admin", at: 3.5, text: "Ứng viên xin hẹn trả lời đến thứ Ba ạ." }
            ]
          },
          {
            title: "Ứng viên retoucher #11 – mới tốt nghiệp, cần đào tạo thêm",
            priority: "normal",
            assignees: ["lead2"],
            status: "Phỏng vấn",
            due: "none",
            createdDaysAgo: 2
          },
          {
            title: "Ứng viên retoucher #05 – bài test chưa đạt (halo quanh cửa sổ)",
            priority: "low",
            assignees: ["khoa"],
            status: "Loại",
            due: "none",
            createdDaysAgo: 4,
            comments: [
              {
                by: "khoa",
                at: 1.0,
                text: "Halo rõ quanh khung cửa, đường dọc nghiêng, 4/10. Đề xuất không nhận đợt này.",
                replies: [{ by: "admin", at: 1.2, text: "Em gửi thư cảm ơn và lưu hồ sơ cho đợt sau ạ." }]
              }
            ]
          },
          {
            title: "Phỏng vấn vòng cuối ứng viên trưởng nhóm QC ca chiều",
            desc: md(
              "Ứng viên đã qua vòng chuyên môn với anh Khoa (bài test QC: 9/10).",
              "",
              "Vòng cuối với @{boss}:",
              "- Cách xử lý khi khách phàn nàn màu trời",
              "- Quản lý ca chiều 8–10 retoucher",
              "- Kế hoạch triển khai checklist QC v2",
              "",
              "Lịch: **thứ Bảy 10/10, 10h**, phòng họp nhỏ."
            ),
            priority: "urgent",
            creator: "linh",
            assignees: ["boss", "khoa"],
            status: "Phỏng vấn",
            due: "today",
            createdDaysAgo: 8,
            comments: [
              {
                by: "khoa",
                at: 2.0,
                text: "Ứng viên có 3 năm kinh nghiệm QC ảnh BĐS, em mong anh gặp sớm.",
                replies: [{ by: "boss", at: 2.5, text: "Ok, xếp lịch thứ Bảy giúp anh." }]
              },
              { by: "linh", at: 7.3, text: "@{boss} em nhắc anh lịch phỏng vấn 10h sáng mai nhé, CV em để trong mô tả rồi ạ." },
              {
                by: "boss",
                at: 8.1,
                text: "Phỏng vấn xong. Ứng viên tốt, tư duy quy trình rõ. @{khoa} với @{linh} bàn mức đề nghị rồi báo anh.",
                replies: [{ by: "khoa", at: 8.15, text: "Dạ anh, đầu tuần em gửi đề xuất ạ." }]
              }
            ]
          },
          {
            title: "Tuyển retoucher thay vị trí của Lộc",
            priority: "high",
            assignees: ["admin", "lead1"],
            status: "Đã nhận việc",
            due: "past",
            createdDaysAgo: 28,
            comments: [
              { by: "lead1", at: 0.5, text: "Nhóm A thiếu 1 người từ tuần sau, cần tuyển gấp trước mùa cao điểm ạ." },
              {
                by: "admin",
                at: 9.0,
                text: "Đã chọn được 2 bạn (bài test 8/10 và 7.5/10), nhận cả 2 vì sắp vào mùa cao điểm. Đi làm từ 5/10.",
                replies: [{ by: "linh", at: 9.3, text: "Tốt quá, cho 2 bạn ngồi gần nhóm A để tiện kèm nhé." }]
              },
              {
                by: "boss",
                at: 25.0,
                text: "2 bạn mới làm tuần đầu thế nào rồi?",
                replies: [
                  { by: "lead1", at: 25.2, text: "Dạ ổn anh, tuần đầu làm đơn nhẹ, đã tự làm được HDR cơ bản." }
                ]
              }
            ]
          },
          {
            title: "Ứng viên retoucher #01 – đã nhận đề nghị, đi làm từ 19/10",
            priority: "normal",
            assignees: ["admin"],
            status: "Đã nhận việc",
            due: "past",
            createdDaysAgo: 5
          },
          {
            title: "Ứng viên retoucher #09 – hẹn phỏng vấn thứ Hai 12/10",
            priority: "normal",
            assignees: [],
            status: "Nhận CV",
            due: "none",
            createdDaysAgo: 1
          },
          {
            title: "Đăng tin tuyển thực tập sinh marketing (tạo trùng)",
            priority: "normal",
            assignees: ["admin"],
            status: "Nhận CV",
            due: "none",
            createdDaysAgo: 9,
            trash: true
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Đào tạo nội bộ",
        description: "Khoá kỹ năng, buổi chia sẻ chuyên môn và đào tạo checklist QC cho đội retoucher.",
        color: "blue",
        tasks: [
          {
            title: "Khoá HDR nâng cao – buổi 1: blend cửa sổ không bị halo",
            desc: md(
              "Giảng viên: @{lead1}. Thời lượng 2 buổi chiều, học trên ảnh thật đã ẩn thông tin khách.",
              "",
              "Nội dung:",
              "- Kéo cửa sổ bằng luminosity mask",
              "- Xử lý viền rèm, song cửa",
              "- Kiểm tra halo ở zoom 200%",
              "",
              "Bài tập về nhà: 3 bộ bracket, nộp vào thư mục `Dao-tao/HDR-nang-cao`."
            ),
            priority: "high",
            creator: "boss",
            assignees: ["nv01", "nv06", "nv11"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 5,
            subtasks: [
              { title: "Buổi học lý thuyết + demo", assignees: ["lead1"], status: "Xong" },
              { title: "Nộp bài tập 3 bộ bracket", assignees: ["nv01", "nv06", "nv11"], status: "Đang làm", due: "week" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.2,
                text: "Khoá này anh muốn mở rộng cho cả nhóm B sau đợt đầu. @{lead1} ghi lại bài giảng nhé.",
                replies: [{ by: "lead1", at: 0.4, text: "Dạ anh, em quay màn hình cả buổi ạ." }]
              },
              {
                by: "nv06",
                at: 3.0,
                text: "Em nộp bộ bracket 1 rồi ạ, cửa sổ phòng bếp em vẫn còn viền nhẹ.",
                replies: [{ by: "lead1", at: 3.2, text: "Giảm feather mask xuống 1–2px rồi thử lại nhé em." }]
              },
              { by: "nv11", at: 4.2, text: "Em xin gia hạn bài 3 sang thứ Hai vì đang làm đơn gấp ca đêm ạ." }
            ]
          },
          {
            title: "Khoá HDR nâng cao – buổi 2: cân màu nội thất và ánh đèn",
            priority: "normal",
            creator: "lead1",
            assignees: ["nv02", "nv09", "nv13"],
            status: "Cần làm",
            due: "next_week",
            createdDaysAgo: 5
          },
          {
            title: "Buổi chia sẻ masking tóc và lông thú cho ảnh chân dung",
            desc: md(
              "Chia sẻ 45 phút, do @{lead2} trình bày. Áp dụng cho đơn chân dung, cưới và ảnh thú cưng của khách Mỹ.",
              "",
              "[ ] Select and Mask hay channel mask: khi nào dùng cái nào",
              "[ ] Xử lý tóc trên nền phức tạp",
              "[ ] Lông thú trên nền trắng"
            ),
            priority: "normal",
            creator: "lead2",
            assignees: ["nv04", "nv08", "nv15"],
            status: "Cần làm",
            due: "week",
            createdDaysAgo: 3,
            files: [{ name: "slide-dao-tao-masking.pdf", hint: "slide masking tóc và lông thú, ví dụ trước/sau" }],
            comments: [
              {
                by: "nv08",
                at: 1.0,
                text: "Em xin trình bày phần lông thú được không ạ? Em làm đơn thú cưng nhiều.",
                replies: [{ by: "lead2", at: 1.2, text: "Được em, chuẩn bị 2 ví dụ nhé." }]
              },
              { by: "nv15", at: 2.5, text: "Buổi học vào giờ nào ạ, em làm ca chiều." }
            ]
          },
          {
            title: "Đào tạo checklist QC v2 cho retoucher ca chiều và ca đêm",
            desc: md(
              "Checklist QC v2 áp dụng từ **5/10**. Ca sáng đã học xong, task này dành cho ca chiều và ca đêm.",
              "",
              "Điểm mới của v2:",
              "- Kiểm tra màu trời theo bảng màu chuẩn (không xanh gắt)",
              "- Kiểm tra kéo cửa sổ ở zoom 200%",
              "- Đường dọc lệch tối đa 0.5°",
              "- Đặt tên file đúng quy ước của từng khách",
              "",
              "@{nv03} @{nv05} @{nv12} là đầu mối từng ca, nhắc các bạn hoàn thành bài kiểm tra."
            ),
            priority: "urgent",
            creator: "khoa",
            assignees: ["nv03", "nv05", "nv12"],
            status: "Đang làm",
            due: "overdue",
            createdDaysAgo: 7,
            subtasks: [
              { title: "Buổi đào tạo ca chiều", assignees: ["khoa"], status: "Xong" },
              { title: "Buổi đào tạo ca đêm (online)", assignees: ["khoa"], status: "Đang làm", due: "overdue" },
              { title: "Thu bài kiểm tra và nhập điểm", assignees: ["nv03"], status: "Cần làm" }
            ],
            comments: [
              {
                by: "khoa",
                at: 2.5,
                text: "Buổi ca chiều xong rồi, 9/10 bạn tham gia. Ca đêm em hẹn tối thứ Tư.",
                replies: [
                  { by: "nv05", at: 2.7, text: "Dạ ca đêm có 2 bạn nghỉ phép, em gửi lại slide cho 2 bạn ạ." }
                ]
              },
              {
                by: "linh",
                at: 5.5,
                text: "Ca đêm bị dời 2 lần rồi, cố gắng xong sớm nhé anh Khoa. Khách Úc đang hỏi về quy trình QC mới.",
                replies: [{ by: "khoa", at: 5.6, text: "Dạ chị, tối thứ Hai em đào tạo online luôn." }]
              },
              {
                by: "nv12",
                at: 6.0,
                text: "Em thấy mục 'đặt tên file' hơi khó nhớ, có bảng tra nhanh không anh?",
                edited: "Em thấy mục đặt tên file theo từng khách hơi khó nhớ, có bảng tra nhanh không anh?",
                replies: [{ by: "khoa", at: 6.2, text: "Có, anh để bảng tra ở wiki QC, in ra dán bàn luôn nhé." }]
              }
            ]
          },
          {
            title: "Bài kiểm tra sau đào tạo QC v2: 20 câu và 5 ảnh thực hành",
            priority: "high",
            creator: "khoa",
            assignees: ["nv07", "nv10", "nv14"],
            status: "Cần làm",
            due: "next_week",
            createdDaysAgo: 2
          },
          {
            title: "Đào tạo cắt nền sản phẩm chuẩn khách Nhật: viền sạch, không răng cưa",
            desc: md(
              "Khách Nhật đang chạy thử, yêu cầu viền rất khắt khe. 3 bạn này sẽ là nhóm chính cho khách.",
              "",
              "- Dùng Pen tool, không dùng magic wand",
              "- Zoom 300% kiểm tra toàn bộ viền",
              "- Giữ bóng đổ tự nhiên, không cắt cụt",
              "- Xuất kèm path trong file PSD"
            ),
            priority: "urgent",
            creator: "linh",
            assignees: ["nv01", "nv07", "nv15"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 4,
            comments: [
              {
                by: "linh",
                at: 0.3,
                text: "@{khoa} anh kiểm giúp em 10 ảnh đầu tiên của nhóm này trước khi gửi khách nhé.",
                replies: [{ by: "khoa", at: 0.6, text: "Ok chị, em kiểm từng ảnh ở zoom 300%." }]
              },
              {
                by: "nv15",
                at: 2.0,
                text: "Ảnh dây chuyền mảnh quá, em mất gần 40 phút một ảnh ạ 😥",
                replies: [
                  { by: "nv01", at: 2.1, text: "Mặt dây thì dùng path, phần dây mảnh dùng channel mask nhanh hơn đó." },
                  { by: "khoa", at: 2.4, text: "Đúng rồi, nhưng nhớ kiểm viền xám sau khi mask nha." }
                ]
              }
            ]
          },
          {
            title: "Buổi chia sẻ day-to-dusk: ánh đèn cửa sổ trông tự nhiên",
            priority: "normal",
            assignees: ["lead2"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 25
          },
          {
            title: "Hướng dẫn dùng Nesso Work cho đội sản xuất",
            desc: md(
              "Từ 25/8 các nhóm báo việc trên Nesso Work thay cho nhóm Zalo và file Excel.",
              "",
              "[x] Đăng nhập lần đầu và đổi mật khẩu",
              "[x] Cách nhận task, đổi trạng thái, bình luận",
              "[x] Nhắn tin kênh #san-xuat và nhắn riêng",
              "[x] Bật thông báo trên điện thoại"
            ),
            priority: "normal",
            assignees: ["admin", "lead1"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 43,
            comments: [
              { by: "lead1", at: 1.0, text: "Nhóm A học xong rồi, mấy bạn ca đêm thích phần nhắn tin hơn Zalo 😄" },
              {
                by: "boss",
                at: 2.0,
                text: "Tốt. Từ tuần sau mọi báo cáo ca đều gửi trên Nesso Work, không gửi Zalo nữa nhé.",
                replies: [{ by: "admin", at: 2.1, text: "Dạ anh, em gửi thông báo cho toàn công ty ạ." }]
              },
              { by: "minh", at: 3.0, text: "Ai quên mật khẩu thì nhắn kênh #it-ho-tro nhé, đừng tự tạo tài khoản mới." }
            ]
          },
          {
            title: "Tổng hợp lỗi hay gặp tuần cao điểm 14–19/9 thành tài liệu đào tạo",
            desc: md(
              "Tổng hợp từ các đơn bị khách trả sửa trong tuần cao điểm:",
              "- Trời thay vào bị xanh gắt, không khớp ánh sáng",
              "- Cửa sổ kéo chưa đủ, cảnh ngoài bị cháy",
              "- Tường trắng ngả vàng do đèn",
              "- Quên xoá dây điện, thùng rác ở ảnh ngoại thất"
            ),
            priority: "high",
            assignees: ["khoa"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 19,
            files: [{ name: "loi-thuong-gap-tuan-cao-diem.pdf", hint: "tài liệu lỗi thường gặp có ảnh minh hoạ trước/sau" }]
          },
          {
            title: "Khoá Photoshop actions và xử lý hàng loạt cho người mới",
            priority: "low",
            creator: "lead1",
            assignees: ["nv02", "nv09", "nv11"],
            status: "Cần làm",
            due: "later",
            createdDaysAgo: 1
          },
          {
            title: "Mời chuyên gia ngoài dạy color grading",
            priority: "low",
            assignees: ["admin"],
            status: "Huỷ",
            due: "none",
            createdDaysAgo: 18
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Onboarding",
        description: "Đón nhân viên mới: tài khoản, máy trạm, buddy, sổ tay; bàn giao khi nghỉ việc.",
        color: "teal",
        tasks: [
          {
            title: "Rà soát tài khoản Nesso Work và phân quyền cho toàn bộ nhân viên",
            priority: "urgent",
            assignees: ["admin", "minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 44,
            comments: [
              {
                by: "minh",
                at: 0.3,
                text: "Đã rà soát xong, phân quyền đúng phòng ban. Còn 3 bạn ca đêm chưa đăng nhập lần nào.",
                replies: [{ by: "lead2", at: 0.6, text: "Tối nay em nhắc ca đêm đăng nhập ạ." }]
              },
              {
                by: "boss",
                at: 1.5,
                text: "Cảm ơn @{minh} và @{admin}, triển khai nhanh hơn anh nghĩ 👍",
                replies: [{ by: "admin", at: 1.6, text: "Dạ, em cảm ơn anh ạ!" }]
              }
            ]
          },
          {
            title: "Onboarding 2 retoucher mới vào làm tuần 41",
            desc: md(
              "Checklist tuần đầu:",
              "[x] Ký hợp đồng thử việc, nhận thẻ ra vào",
              "[x] Tài khoản Nesso Work, VPN, ổ NAS",
              "[x] Giới thiệu nội quy, ca làm, quy định bảo mật file khách",
              "[x] Buddy kèm 2 tuần",
              "[ ] Làm thử 3 đơn HDR nhẹ có QC kèm",
              "[ ] Họp đánh giá nhanh với trưởng ca"
            ),
            priority: "high",
            assignees: ["admin", "lead1"],
            status: "Đang làm",
            due: "tomorrow",
            createdDaysAgo: 7,
            subtasks: [
              { title: "Chuẩn bị bàn, máy, màn hình hiệu chuẩn", assignees: ["admin"], status: "Xong" },
              { title: "Giao 3 đơn HDR nhẹ làm thử", assignees: ["lead1"], status: "Đang làm" },
              { title: "Họp đánh giá tuần đầu", assignees: ["lead1"], status: "Cần làm", due: "tomorrow" }
            ],
            comments: [
              { by: "admin", at: 0.5, text: "Thứ Hai 2 bạn vào ca sáng 7h30, em đón và giới thiệu văn phòng trước khi giao cho trưởng ca ạ." },
              {
                by: "lead1",
                at: 3.0,
                text: "2 bạn bắt nhịp tốt, bạn ngồi bàn 12 làm HDR khá nhanh.",
                replies: [
                  {
                    by: "boss",
                    at: 3.4,
                    text: "Tốt. Hỏi các bạn có gì chưa quen với quy trình không, góp ý để cập nhật sổ tay nhân viên."
                  }
                ]
              },
              {
                by: "admin",
                at: 6.3,
                text: "Thứ Hai 12/10 mình họp 15 phút đánh giá tuần đầu rồi đóng task này nhé.",
                replies: [{ by: "lead1", at: 6.5, text: "Ok, 11h thứ Hai nhé." }]
              }
            ]
          },
          {
            title: "Cấp tài khoản Nesso Work, VPN và quyền NAS cho nhân viên mới tuần 41",
            priority: "normal",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 8
          },
          {
            title: "Chuẩn bị máy trạm và màn hình hiệu chuẩn màu cho 6 retoucher đợt tháng 10",
            priority: "high",
            assignees: ["admin"],
            status: "Cần làm",
            due: "later",
            createdDaysAgo: 3,
            comments: [
              {
                by: "minh",
                at: 0.5,
                text: "Kho còn 2 máy đủ cấu hình, cần mua thêm 4 máy và 6 màn hình. Mai anh gửi cấu hình đề xuất.",
                replies: [{ by: "admin", at: 0.7, text: "Dạ, em đưa vào đề xuất ngân sách gửi anh giám đốc luôn ạ." }]
              },
              { by: "boss", at: 2.0, text: "Màn hình phải hiệu chuẩn được, đừng tiết kiệm khoản này." }
            ]
          },
          {
            title: "Cập nhật sổ tay nhân viên: ca làm, nghỉ phép, bảo mật file khách",
            desc: md(
              "Bản cũ từ năm ngoái, nhiều mục đã khác. Cần cập nhật:",
              "- Giờ ca sáng 7:30–16:00, ca chiều 13:30–22:00, ca đêm theo lịch",
              "- Quy trình xin nghỉ phép trên Nesso Work",
              "- Quy định không chép file khách ra USB, không gửi qua mạng xã hội",
              "- Phần mới: checklist QC v2, quy định đặt tên file"
            ),
            priority: "normal",
            assignees: ["admin", "linh"],
            status: "Đang làm",
            due: "next_week",
            createdDaysAgo: 12
          },
          {
            title: "Phân công buddy kèm 2 tuần đầu cho retoucher mới tuần 41",
            priority: "normal",
            assignees: ["lead1", "lead2"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 8
          },
          {
            title: "Quay video hướng dẫn quy trình nhận đơn – trả file cho người mới",
            priority: "low",
            assignees: [],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 10
          },
          {
            title: "Bàn giao công việc và thu hồi tài khoản khi Lộc nghỉ việc",
            desc: md(
              "Ngày làm việc cuối của Lộc: **12/9**.",
              "",
              "[x] Bàn giao đơn đang làm cho nhóm A",
              "[x] Chuyển file làm dở lên NAS",
              "[x] Khoá tài khoản Nesso Work, VPN sau 18h ngày 12/9",
              "[x] Thu lại thẻ ra vào"
            ),
            priority: "normal",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 30
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Đánh giá & phúc lợi",
        description: "Đánh giá thử việc, khám sức khoẻ, team building, quà lễ và phụ cấp.",
        color: "green",
        tasks: [
          {
            title: "Chốt kết quả đánh giá thử việc 3 nhân viên tháng 9",
            desc: md(
              "3 bạn kết thúc thử việc cuối tháng 9. Trưởng ca đã chấm, chờ anh chốt:",
              "- @{nv13}: đạt, đề xuất ký hợp đồng chính thức",
              "- @{nv14}: đạt, cần cải thiện tốc độ",
              "- @{nv15}: đạt, giỏi cắt nền sản phẩm",
              "",
              "Sau khi anh chốt, @{admin} làm hợp đồng."
            ),
            priority: "high",
            creator: "linh",
            assignees: ["boss"],
            status: "Đang làm",
            due: "overdue",
            createdDaysAgo: 10,
            comments: [
              { by: "lead2", at: 1.0, text: "Phiếu đánh giá nhóm B em nộp đủ rồi ạ." },
              { by: "linh", at: 5.0, text: "@{boss} anh xem giúp em trong tuần này, các bạn đang hỏi về hợp đồng ạ." },
              {
                by: "boss",
                at: 7.0,
                text: "Anh xem rồi, cả 3 đều ổn. Riêng mức lương chính thức, @{linh} lên gặp anh chiều thứ Sáu nhé.",
                replies: [{ by: "linh", at: 7.1, text: "Dạ anh." }]
              },
              {
                by: "admin",
                at: 9.4,
                text: "@{boss} hợp đồng em soạn sẵn rồi ạ, chỉ chờ anh chốt mức lương là em in để ký."
              }
            ]
          },
          {
            title: "Đánh giá kết thúc thực tập – thực tập sinh marketing (Hạnh)",
            desc: md(
              "Thực tập đến hết **30/9**. An nhận xét chuyên môn, chị Linh duyệt.",
              "",
              "- Hoàn thành tốt bài recap team building, bộ ảnh Trung thu",
              "- Chủ động, viết caption tốt",
              "- Cấp giấy xác nhận thực tập trước 30/9"
            ),
            priority: "normal",
            assignees: ["admin", "linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 15
          },
          {
            title: "Khám sức khoẻ định kỳ 2026 cho toàn công ty",
            desc: md(
              "Chọn 1 phòng khám gần văn phòng, chia 3 đợt để không ảnh hưởng ca sản xuất.",
              "",
              "[ ] Lấy báo giá 2–3 phòng khám",
              "[ ] Chia lịch theo ca sáng/chiều/đêm",
              "[ ] Thêm gói khám mắt (dân retouch nhìn màn hình nhiều)"
            ),
            priority: "normal",
            creator: "boss",
            assignees: ["admin"],
            status: "Cần làm",
            due: "later",
            createdDaysAgo: 9
          },
          {
            title: "Team building Vũng Tàu 26–27/9: xe, khách sạn, chương trình",
            priority: "normal",
            assignees: ["admin", "linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 37,
            files: [{ name: "chuong-trinh-team-building-vung-tau.pdf", hint: "lịch trình 2 ngày 1 đêm, phân xe, phân phòng" }],
            subtasks: [
              { title: "Đặt xe 45 chỗ và khách sạn", assignees: ["admin"], status: "Xong" },
              { title: "Chương trình gala tối thứ Bảy và trò chơi bãi biển", assignees: ["linh", "nv02", "nv09"], status: "Xong" }
            ],
            comments: [
              { by: "admin", at: 2.0, text: "Đã chốt 52 người đi, ca trực ở lại có phụ cấp riêng ạ." },
              {
                by: "boss",
                at: 5.0,
                text: "Ai trực ca ở lại thì tháng sau công ty tổ chức bữa riêng cho các bạn nhé.",
                replies: [{ by: "lead2", at: 5.2, text: "Cảm ơn anh, em báo lại ca trực ạ 🙏" }]
              },
              {
                by: "linh",
                at: 24.5,
                text: "Chuyến đi vui quá, cảm ơn @{admin} và ban tổ chức đã lo chu đáo 🏖️",
                replies: [{ by: "boss", at: 24.6, text: "Đồng ý, tổ chức rất tốt 👏" }]
              }
            ]
          },
          {
            title: "Phát biểu khai mạc và trao giải team building",
            priority: "normal",
            creator: "admin",
            assignees: ["boss"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 16,
            comments: [
              {
                by: "admin",
                at: 0.2,
                text: "@{boss} em chuẩn bị 3 giải: đội thắng trò chơi, cây hài, nhân viên chăm chỉ quý 3 ạ.",
                replies: [
                  { by: "boss", at: 0.8, text: "Thêm 1 giải cho ca trực ở lại văn phòng nhé, các bạn ấy thiệt thòi nhất." }
                ]
              },
              { by: "admin", at: 1.5, text: "Quà và phong bì đã chuẩn bị xong, em để trong vali chung ạ." },
              { by: "boss", at: 1.6, text: "Ok, cảm ơn em." }
            ]
          },
          {
            title: "Quà 20/10 cho chị em toàn công ty",
            priority: "high",
            assignees: ["admin"],
            status: "Cần làm",
            due: "next_week",
            createdDaysAgo: 4,
            subtasks: [
              { title: "Khảo sát nhanh chọn quà (3 lựa chọn)", assignees: ["admin"], status: "Đang làm" },
              { title: "Đặt hoa và bánh cho buổi trà chiều", assignees: ["admin"], status: "Cần làm", due: "next_week" }
            ],
            comments: [
              {
                by: "admin",
                at: 0.5,
                text: "Em đề xuất 3 lựa chọn: voucher spa, bình giữ nhiệt + son, hoặc kính lọc ánh sáng xanh ạ.",
                replies: [{ by: "lead1", at: 0.9, text: "Kính lọc ánh sáng xanh thiết thực cho bên sản xuất đó 😄" }]
              },
              {
                by: "boss",
                at: 1.5,
                text: "Cho chị em tự chọn 1 trong 3 món, mỗi người một kiểu càng vui.",
                replies: [{ by: "admin", at: 1.6, text: "Dạ anh, em làm form chọn quà ngay ạ." }]
              },
              {
                by: "linh",
                at: 3.2,
                text: "Nhớ chuẩn bị quà cho cả các bạn nữ ca đêm, đừng để sót nhé.",
                edited: "Nhớ chuẩn bị quà cho cả các bạn nữ ca đêm và 2 bạn mới vào, đừng để sót nhé."
              }
            ]
          },
          {
            title: "Tổng hợp khảo sát mức độ hài lòng nhân viên quý 3",
            priority: "normal",
            assignees: ["admin"],
            status: "Đang làm",
            due: "none",
            createdDaysAgo: 9,
            files: [{ name: "khao-sat-hai-long-q3.xlsx", hint: "kết quả khảo sát theo phòng ban, điểm trung bình, góp ý" }]
          },
          {
            title: "Phụ cấp ca đêm và tăng ca tuần cao điểm 14–19/9",
            priority: "urgent",
            assignees: ["admin", "linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 21,
            comments: [
              { by: "lead1", at: 0.5, text: "Bảng chấm công ca đêm nhóm A gửi rồi ạ, 11 bạn có tăng ca." },
              {
                by: "lead2",
                at: 0.7,
                text: "Nhóm B 9 bạn, có 2 bạn làm liền 3 đêm, em đề nghị thưởng thêm.",
                replies: [
                  { by: "linh", at: 2.5, text: "Đã đưa vào đề xuất, @{boss} duyệt rồi nhé, trả cùng lương tháng 9." }
                ]
              }
            ]
          },
          {
            title: "Đặt bánh sinh nhật tháng 10 (tạo trùng)",
            priority: "low",
            assignees: ["admin"],
            status: "Cần làm",
            due: "none",
            createdDaysAgo: 7,
            trash: true
          }
        ]
      }
    ]
  }
];
