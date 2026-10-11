import type { ProjectSeed, StatusSeed } from "../types.js";

/** Join lines of mini-markup (single newline = line break / list item, "" = new paragraph). */
const L = (...lines: string[]): string => lines.join("\n");

const itFlow: StatusSeed[] = [
  { name: "Backlog", category: "active", color: "slate" },
  { name: "Đang làm", category: "active", color: "blue" },
  { name: "Review", category: "active", color: "violet" },
  { name: "Xong", category: "done", color: "green" },
  { name: "Huỷ", category: "closed", color: "gray" }
];

const bugFlow: StatusSeed[] = [
  { name: "Mới", category: "active", color: "red" },
  { name: "Đã xác nhận", category: "active", color: "orange" },
  { name: "Đang sửa", category: "active", color: "blue" },
  { name: "Chờ kiểm tra", category: "active", color: "amber" },
  { name: "Đã đóng", category: "done", color: "green" },
  { name: "Không sửa", category: "closed", color: "gray" }
];

const qtFlow: StatusSeed[] = [
  { name: "Đề xuất", category: "active", color: "slate" },
  { name: "Đang thử nghiệm", category: "active", color: "violet" },
  { name: "Đang áp dụng", category: "active", color: "blue" },
  { name: "Hoàn tất", category: "done", color: "green" },
  { name: "Không áp dụng", category: "closed", color: "gray" }
];

export const projectsItQt: ProjectSeed[] = [
  // ===================================================================================================
  // IT — Website & Hệ thống nội bộ
  // ===================================================================================================
  {
    key: "IT",
    name: "Website & Hệ thống nội bộ",
    description:
      "Website công ty, Nesso Work, NAS, mạng và hỗ trợ IT cho văn phòng lẫn sản xuất. Lỗi/sự cố ghi vào list Bug & sự cố, việc lớn ghi vào các list còn lại.",
    icon: "code",
    color: "indigo",
    visibility: "public",
    owner: "minh",
    members: {
      minh: "manage",
      boss: "manage",
      linh: "manage",
      an: "submit",
      admin: "submit",
      khoa: "submit",
      acc1: "view",
      lead1: "submit"
    },
    workflow: itFlow,
    createdOn: "2026-08-25",
    lists: [
      // ---------------------------------------------------------------------------------------------
      {
        name: "Bug & sự cố",
        description: "Báo lỗi và sự cố IT. Ghi rõ tên máy, phòng, các bước tái hiện và ảnh chụp màn hình nếu có.",
        color: "red",
        workflow: bugFlow,
        tasks: [
          {
            title: "[Sự cố] NAS-02 share \\Retouch\\Input bị mất quyền ghi của nhóm B",
            desc: L(
              "Sáng 21/9, ngay sau khi chuyển sang NAS mới, nhóm B ca sáng không lưu được file vào `\\\\NAS-02\\Retouch\\Input`.",
              "",
              "1. Mở thư mục đơn bất kỳ trong `Input`",
              "2. Lưu PSD từ Photoshop hoặc kéo thả file vào",
              "3. Báo lỗi “You need permission to perform this action”",
              "",
              "Nhóm A và QC vẫn ghi bình thường. Báo giúp @{lead2}."
            ),
            priority: "urgent",
            creator: "lead1",
            assignees: ["minh"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 19,
            comments: [
              {
                by: "minh",
                at: 0.05,
                text: "Đã nhận, em kiểm tra ngay. Nghi lúc ánh xạ quyền bị sót nhóm `retouch-b` ở thư mục gốc.",
                replies: [
                  { by: "lead1", at: 0.08, text: "Nhanh giúp anh nha, 9h có đơn 180 ảnh khách Úc cần trả trước 14h 🙏" }
                ]
              },
              {
                by: "minh",
                at: 0.15,
                text: "Đã cấp lại quyền Modify cho `retouch-b` và bật kế thừa xuống thư mục con. Mọi người ngắt ổ mạng rồi vào lại giúp em.",
                files: [
                  { name: "log-nas-02-21-09.txt", hint: "log phân quyền NAS-02 sáng 21/9, nhóm retouch-b thiếu quyền Modify ở Input" }
                ],
                replies: [
                  { by: "lead1", at: 0.2, text: "Ok rồi, bên B lưu được rồi nhé. Cảm ơn em." },
                  { by: "khoa", at: 0.25, text: "Thư mục `QC-Done` bên anh cũng kiểm tra rồi, không bị gì." }
                ]
              },
              {
                by: "boss",
                at: 0.4,
                text: "Sau vụ này @{minh} ghi lại checklist phân quyền, lần sau chuyển đổi đừng để sót nữa nhé.",
                replies: [{ by: "minh", at: 0.5, text: "Dạ anh, em bổ sung vào tài liệu chuyển đổi NAS luôn." }]
              }
            ]
          },
          {
            title: "[Bug] Upload ảnh HEIC từ iPhone báo lỗi định dạng",
            desc: L(
              "Đính kèm ảnh chụp từ iPhone (đuôi `.heic`) vào task hoặc bình luận thì báo “Định dạng không được hỗ trợ”.",
              "",
              "**Các bước tái hiện**",
              "1. Mở Nesso Work trên iPhone",
              "2. Vào task bất kỳ → Đính kèm → chọn ảnh từ thư viện",
              "3. Chọn ảnh chụp bằng camera mặc định (HEIC)",
              "4. Báo lỗi định dạng, file không lên",
              "",
              "**Mong muốn:** tự chuyển sang JPG hoặc cho lưu nguyên HEIC. Ảnh JPG/PNG vẫn upload bình thường."
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["minh"],
            status: "Đang sửa",
            due: "week",
            createdDaysAgo: 6,
            files: [
              { name: "Ảnh lỗi upload HEIC.png", hint: "ảnh chụp màn hình điện thoại báo lỗi định dạng khi đính kèm ảnh HEIC" }
            ],
            comments: [
              {
                by: "minh",
                at: 0.3,
                text: "Em tái hiện được. Backend đang chặn theo danh sách MIME, chưa có `image/heic`. Em sẽ thêm chuyển sang JPG lúc upload.",
                edited:
                  "Em tái hiện được. Backend đang chặn theo danh sách MIME, chưa có `image/heic` và `image/heif`. Em sẽ thêm bước chuyển sang JPG lúc upload.",
                replies: [
                  { by: "khoa", at: 0.4, text: "Nhớ giữ nguyên chất lượng nhé, QC hay chụp ảnh lỗi màu gửi qua đây." }
                ]
              },
              {
                by: "linh",
                at: 2,
                text: "Tạm thời mọi người chỉnh iPhone sang **Tương thích nhất** (Cài đặt → Camera → Định dạng) là chụp ra JPG nha.",
                replies: [{ by: "minh", at: 2.1, text: "Dạ đúng rồi chị, em ghim hướng dẫn này trên kênh it-ho-tro rồi." }]
              },
              {
                by: "minh",
                at: 5.4,
                text: "Bản sửa đã chạy trên môi trường thử, chờ ghép vào bản build tuần sau. @{khoa} rảnh test giúp em vài ảnh HEIC nhé."
              }
            ]
          },
          {
            title: "[Bug] Nesso Work: thông báo trên điện thoại đến trễ 10–15 phút",
            desc: L(
              "Anh được nhắc tên trong bình luận lúc 9h05 mà 9h20 điện thoại mới báo. Trên máy tính thì hiện ngay.",
              "",
              "- Điện thoại Android, đã cho phép thông báo",
              "- Không bật tiết kiệm pin",
              "",
              "Mấy bạn trưởng ca cũng than y vậy. @{minh} xem giúp anh."
            ),
            priority: "high",
            creator: "boss",
            assignees: ["minh"],
            status: "Đã xác nhận",
            due: "tomorrow",
            createdDaysAgo: 4,
            comments: [
              {
                by: "minh",
                at: 0.2,
                text: "Log server gửi đúng giờ, trễ là ở dịch vụ đẩy thông báo của Android khi app chạy nền. Em thử đặt mức ưu tiên cao cho thông báo nhắc tên.",
                replies: [{ by: "boss", at: 0.3, text: "Ok em, nhắc tên với giao việc phải đến ngay là được." }]
              },
              { by: "lead1", at: 1, text: "iPhone bên em gần như tức thì, chỉ máy Android bị thôi anh Minh ạ." },
              {
                by: "minh",
                at: 3.7,
                text: "@{boss} em đã đẩy bản sửa lên môi trường thử, anh cài lại app bản thử giúp em, mai em đo độ trễ cả ngày ạ.",
                replies: [{ by: "boss", at: 3.8, text: "Ok, tối nay anh cài." }]
              }
            ]
          },
          {
            title: "VPN rớt liên tục khi làm ca đêm từ nhà",
            desc: L(
              "Mấy đêm rush vừa rồi, 3 bạn ca đêm làm từ nhà bị rớt VPN khoảng 30–40 phút/lần, mỗi lần rớt là file PSB đang mở trên NAS bị treo.",
              "",
              "1. Kết nối VPN bằng tài khoản cá nhân",
              "2. Mở file từ `\\\\NAS-01\\Retouch\\Input`",
              "3. Sau khoảng 30 phút VPN tự ngắt, Photoshop treo khi lưu",
              "",
              "Ca đêm cần ổn định từ 22h đến 6h."
            ),
            priority: "high",
            creator: "lead1",
            assignees: ["minh"],
            status: "Chờ kiểm tra",
            due: "overdue",
            createdDaysAgo: 22,
            comments: [
              {
                by: "minh",
                at: 0.2,
                text: "Em đã tăng thời gian giữ phiên lên 12 tiếng và tắt tự ngắt khi không hoạt động. Mọi người cập nhật file cấu hình VPN mới em gửi trên kênh nhé.",
                replies: [{ by: "lead1", at: 1, text: "Đêm qua còn rớt 1 lần lúc 3h sáng em ơi." }]
              },
              {
                by: "minh",
                at: 2,
                text: "Thêm nguyên nhân: mạng nhà 1 bạn đổi IP liên tục. Em chuyển sang giao thức ổn định hơn, ai còn bị thì báo em kèm giờ rớt."
              },
              {
                by: "minh",
                at: 17,
                text: "Từ khi lên NAS-02 thì ổn hơn nhiều, em để Chờ kiểm tra thêm vài đêm. @{lead1} anh xác nhận giúp em nếu cả tuần không rớt nữa nhé.",
                replies: [{ by: "lead1", at: 21.5, text: "Tuần này mới rớt 1 lần, theo dõi tiếp tới thứ 2 nha." }]
              }
            ]
          },
          {
            title: "NAS-02 chậm khi mở file PSB trên 2GB sau khi chuyển đổi",
            desc: L(
              "Từ sáng 21/9, mở file PSB lớn (ghép HDR nhiều lớp) trên NAS mới mất 2–3 phút, trên NAS cũ chỉ khoảng 40 giây.",
              "",
              "- Thư mục: `\\\\NAS-02\\Retouch\\Working`",
              "- Máy bị nặng nhất: PC-SX-03, PC-SX-07, PC-SX-12",
              "- Copy file về ổ D: rồi mở thì bình thường",
              "",
              "[x] Khởi động lại máy trạm",
              "[x] Thử dây mạng khác",
              "[ ] Kiểm tra cấu hình SMB trên NAS",
              "[ ] Kiểm tra cache SSD của NAS"
            ),
            priority: "urgent",
            creator: "khoa",
            assignees: ["minh", "admin"],
            status: "Đang sửa",
            due: "overdue",
            createdDaysAgo: 19,
            subtasks: [
              { title: "Bật SMB multichannel và đo lại tốc độ", assignees: ["minh"], status: "Đang sửa" },
              { title: "Lắp thêm 2 SSD làm cache đọc cho NAS-02", assignees: ["admin"], status: "Đã xác nhận", due: "week" }
            ],
            comments: [
              {
                by: "minh",
                at: 0.3,
                text: "Đo từ PC-SX-07 tốc độ đọc chỉ ~110MB/s, NAS cũ gộp 2 đường mạng nên nhanh hơn. Em đang cấu hình lại.",
                files: [
                  { name: "toc-do-doc-ghi-nas-02.png", hint: "biểu đồ tốc độ đọc ghi NAS-02 đo từ máy PC-SX-07, khoảng 110MB/s" }
                ],
                replies: [{ by: "khoa", at: 0.5, text: "QC mở file kiểm tra cũng chậm, mỗi file chờ cả phút 😅" }]
              },
              {
                by: "boss",
                at: 2,
                text: "Cái này ảnh hưởng thẳng vào năng suất, ưu tiên cao nhất cho anh. Cần mua gì thì @{minh} gửi đề xuất.",
                replies: [
                  { by: "minh", at: 2.2, text: "Dạ anh, em đề xuất thêm 2 SSD làm cache, @{admin} đang lấy báo giá ạ." },
                  { by: "admin", at: 3, text: "Đã gửi 3 báo giá cho chị Linh duyệt rồi nhé." }
                ]
              },
              {
                by: "minh",
                at: 16.5,
                text: "Cập nhật: bật multichannel xong, mở file 2GB còn khoảng 55 giây. Chờ SSD cache về (dự kiến thứ 3) em đo lại."
              }
            ]
          },
          {
            title: "[Bug] Photoshop crash khi mở file PSB lớn trên máy PC-SX-07",
            priority: "high",
            creator: "lead1",
            assignees: ["minh"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 24,
            subtasks: [
              { title: "Cập nhật driver card đồ hoạ", assignees: ["minh"], status: "Đã đóng" },
              { title: "Chuyển scratch disk sang ổ SSD riêng", assignees: ["minh"], status: "Đã đóng" }
            ],
            comments: [
              { by: "lead1", at: 0.1, text: "Máy này văng 4 lần trong ca sáng rồi, bạn ngồi máy này phải qua máy dự phòng làm tạm." },
              {
                by: "minh",
                at: 0.4,
                text: "Ổ C: còn có 6GB mà scratch disk để ở C: nên đầy là văng. Em dọn ổ, chuyển scratch sang SSD phụ và cập nhật driver card đồ hoạ rồi.",
                replies: [{ by: "lead1", at: 1.2, text: "Hôm nay chạy ổn cả ngày, đóng ticket được rồi em." }]
              }
            ]
          },
          {
            title: "Máy in tầng 2 kẹt giấy và in lệch lề",
            priority: "low",
            assignees: ["admin"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 30
          },
          {
            title: "Wifi tầng 3 chập chờn ở khu phòng họp",
            priority: "normal",
            creator: "an",
            assignees: ["minh"],
            status: "Đang sửa",
            due: "none",
            createdDaysAgo: 9,
            comments: [
              {
                by: "an",
                at: 0.1,
                text: "Họp video với khách ở phòng họp tầng 3 bị đứng hình 2 lần, sóng chỉ còn 1 vạch.",
                replies: [
                  {
                    by: "minh",
                    at: 1,
                    text: "Bộ phát tầng 3 đang treo sau tủ hồ sơ, em sẽ dời ra giữa trần và thêm 1 bộ cho phòng họp. Đã đặt hàng, chờ giao."
                  }
                ]
              }
            ]
          },
          {
            title: "[Bug] Nesso Work: kéo thả thẻ giữa các cột Kanban bị nhảy về chỗ cũ",
            desc: L(
              "1. Mở dự án Cải tiến quy trình retouch → chế độ Bảng",
              "2. Kéo một thẻ từ “Đề xuất” sang “Đang thử nghiệm”",
              "3. Thẻ nhảy về cột cũ, F5 lại mới thấy ở cột mới",
              "",
              "Bị cả trên Chrome lẫn Edge, khoảng 1/3 số lần kéo."
            ),
            priority: "normal",
            creator: "khoa",
            assignees: ["minh"],
            status: "Chờ kiểm tra",
            due: "none",
            createdDaysAgo: 7,
            comments: [
              {
                by: "minh",
                at: 2,
                text: "Do giao diện cập nhật trước khi server trả về, em đã sửa lại thứ tự xử lý. Anh thử lại giúp em nhé.",
                replies: [
                  { by: "khoa", at: 3.5, text: "Thử 10 lần ok 9, còn 1 lần nhảy lúc mạng chậm. Để anh theo dõi thêm." }
                ]
              }
            ]
          },
          {
            title: "Máy PC-QC-02 không nhận màn hình thứ hai sau khi cập nhật Windows",
            desc: "Sau bản cập nhật Windows tối 24/9, màn hình phụ báo “No signal”. Đã thử đổi cáp HDMI sang DisplayPort, vẫn không nhận.",
            priority: "normal",
            creator: "khoa",
            assignees: ["admin"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 15
          },
          {
            title: "[Bug] Không mở được đường dẫn thư mục NAS trong task trên máy Mac",
            priority: "low",
            creator: "an",
            assignees: ["minh"],
            status: "Không sửa",
            createdDaysAgo: 17,
            comments: [
              { by: "an", at: 0.2, text: "Bấm vào đường dẫn `\\\\NAS-02\\Marketing` trong task trên MacBook thì không mở ra gì cả." },
              {
                by: "minh",
                at: 1,
                text: "Trình duyệt chặn mở ổ mạng trực tiếp, giới hạn bảo mật nên mình không sửa được. Trên Mac vào Finder → Kết nối máy chủ, gõ `smb://nas-02/Marketing` nhé.",
                replies: [{ by: "an", at: 1.1, text: "Ok anh, em lưu vào mục Yêu thích cho nhanh 👍" }]
              }
            ]
          },
          {
            title: "Quyền thư mục \\Marketing\\Portfolio: không xoá được file cũ",
            priority: "normal",
            creator: "an",
            assignees: ["minh"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 18,
            comments: [
              {
                by: "an",
                at: 0.05,
                text: "Em dọn ảnh portfolio cũ trong `\\\\NAS-02\\Marketing\\Portfolio` thì báo không đủ quyền xoá.",
                replies: [
                  { by: "minh", at: 0.3, text: "Nhóm marketing chỉ có quyền đọc ở đây do sót lúc ánh xạ. Sửa rồi, An thử lại nhé." }
                ]
              }
            ]
          },
          {
            title: "[Bug] Upload file trên 500MB vào task bị treo ở 99%",
            desc: L(
              "Upload file PSB 620MB làm file mẫu lên task thì thanh tiến trình chạy tới 99% rồi đứng, chờ 15 phút không xong.",
              "",
              "File dưới 200MB bình thường. Có cần nén ZIP trước không ạ?"
            ),
            priority: "high",
            creator: "lead1",
            assignees: [],
            status: "Mới",
            due: "none",
            createdDaysAgo: 1,
            comments: [
              {
                by: "khoa",
                at: 0.4,
                text: "File cỡ này nên để trên NAS rồi dán đường dẫn vào task, nhưng app cũng nên báo lỗi chứ không treo vậy. @{minh} xem khi rảnh nhé.",
                replies: [
                  { by: "minh", at: 0.6, text: "Dạ, giới hạn hiện tại là 500MB nhưng chưa báo lỗi rõ. Thứ 2 em nhận ticket này." }
                ]
              }
            ]
          },
          {
            title: "Màn hình máy PC-SX-11 bị ám vàng, nghi lệch profile màu",
            priority: "high",
            creator: "khoa",
            assignees: ["minh", "khoa"],
            status: "Đã xác nhận",
            due: "today",
            createdDaysAgo: 3,
            comments: [
              {
                by: "khoa",
                at: 0.2,
                text: "Ảnh từ máy này qua QC toàn bị trả vì trời ngả xanh lá, hoá ra màn hình ám vàng nên bạn chỉnh bù ngược.",
                files: [
                  { name: "anh-man-hinh-pc-sx-11.jpg", hint: "ảnh chụp màn hình PC-SX-11 ám vàng đặt cạnh màn hình chuẩn" }
                ],
                replies: [
                  {
                    by: "minh",
                    at: 0.5,
                    text: "Profile màu bị Windows Update ghi đè. Em cài lại profile cũ trước, thứ 7 anh mang máy đo màu qua đo lại giúp em nha."
                  }
                ]
              },
              { by: "khoa", at: 2.9, text: "Chiều nay anh qua đo, xong cập nhật kết quả ở đây." }
            ]
          },
          {
            title: "Mất ổ mạng Z: trên 4 máy ca chiều sau khi khởi động lại",
            priority: "urgent",
            creator: "lead1",
            assignees: ["minh"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 19,
            comments: [
              { by: "lead1", at: 0.02, text: "Ca chiều 4 máy PC-SX-09 → PC-SX-12 mở lên không thấy ổ Z:, cần gấp ạ." },
              {
                by: "minh",
                at: 0.1,
                text: "Script ánh xạ ổ còn trỏ về NAS-01 cũ. Em đã chạy lại `net use Z: \\\\NAS-02\\Retouch /persistent:yes` trên 4 máy, mọi người mở lại File Explorer nhé.",
                replies: [{ by: "lead1", at: 0.15, text: "Thấy ổ Z rồi, cảm ơn em." }]
              }
            ]
          },
          {
            title: "[Bug] Nesso Work: tìm kiếm task không ra kết quả khi gõ có dấu",
            desc: L(
              "Gõ “bầu trời” ra 0 kết quả, gõ “bau troi” lại ra 12 task. Mong muốn: có dấu hay không dấu đều ra như nhau.",
              "",
              "Từ khoá để thử: `checklist`, `cửa sổ`, `cua so`."
            ),
            priority: "normal",
            creator: "linh",
            assignees: ["minh"],
            status: "Đang sửa",
            due: "next_week",
            createdDaysAgo: 5
          },
          {
            title: "Chuột và bàn phím không dây phòng QC bị nhiễu, gõ chậm",
            priority: "low",
            creator: "khoa",
            assignees: [],
            status: "Mới",
            due: "none",
            createdDaysAgo: 2
          },
          {
            title: "Camera hành lang tầng 1 mất hình vào ban đêm",
            desc: "Từ khoảng 22h camera hành lang tầng 1 chỉ ra màn hình đen, ban ngày bình thường. Nghi hỏng đèn hồng ngoại.",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Đã xác nhận",
            due: "none",
            createdDaysAgo: 8
          },
          {
            title: "Bộ lưu điện phòng server kêu bíp liên tục",
            desc: "UPS phòng server kêu bíp mỗi 30 giây từ chiều 28/9, đèn báo pin màu cam. Tải hiện tại khoảng 78%.",
            priority: "high",
            creator: "admin",
            assignees: ["minh"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 12
          },
          {
            title: "[Bug] Nesso Work: ảnh đính kèm trong bình luận không hiện ảnh xem trước",
            priority: "low",
            creator: "an",
            assignees: [],
            status: "Mới",
            due: "none",
            createdDaysAgo: 0
          },
          {
            title: "Lightroom báo hết hạn bản quyền trên 3 máy sản xuất",
            priority: "urgent",
            creator: "lead1",
            assignees: ["admin", "minh"],
            status: "Đã đóng",
            due: "past",
            createdDaysAgo: 10,
            comments: [
              { by: "lead1", at: 0.02, text: "3 máy ca sáng mở Lightroom báo hết hạn bản quyền, không xuất ảnh được." },
              {
                by: "admin",
                at: 0.1,
                text: "Gói license gia hạn tự động bị lỗi hôm qua. Đã gia hạn lại, mọi người đăng xuất rồi đăng nhập lại app nhé.",
                replies: [{ by: "minh", at: 0.2, text: "Em đăng nhập lại trên 3 máy rồi, chạy bình thường." }]
              }
            ]
          },
          {
            title: "[Trùng] Không đính kèm được ảnh chụp từ iPhone",
            priority: "normal",
            creator: "lead1",
            status: "Mới",
            due: "none",
            createdDaysAgo: 6,
            trash: true
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Website công ty",
        description: "Làm lại website: giao diện mới, gallery before/after, form báo giá, SEO, tốc độ, bản EN/JA. Mục tiêu launch 15/10.",
        color: "indigo",
        tasks: [
          {
            title: "Duyệt giao diện trang chủ mới (desktop + mobile)",
            desc: L(
              "Bản thiết kế trang chủ v3 đã sửa theo góp ý buổi họp 30/9.",
              "",
              "- Desktop: [Trang chủ v3](https://example.com/design/trang-chu-v3)",
              "- Mobile: [Trang chủ v3 mobile](https://example.com/design/trang-chu-v3-mobile)",
              "",
              "@{boss} anh duyệt giúp em trước 8/10 để kịp ráp code ạ."
            ),
            priority: "urgent",
            creator: "an",
            assignees: ["boss"],
            status: "Review",
            due: "overdue",
            createdDaysAgo: 9,
            comments: [
              {
                by: "boss",
                at: 1.5,
                text: "Banner đầu trang hơi tối. Lấy ảnh căn nhà lúc hoàng hôn cho nổi dịch vụ day-to-dusk, nút “Gửi ảnh báo giá” làm to hơn.",
                replies: [{ by: "an", at: 1.7, text: "Dạ em sửa ngay anh." }]
              },
              {
                by: "an",
                at: 4,
                text: "Em đã đổi banner sang ảnh day-to-dusk và tăng nút CTA. Bản mobile em gửi kèm.",
                edited: "Em đã đổi banner sang ảnh day-to-dusk, tăng nút CTA và rút gọn đoạn giới thiệu. Bản mobile em gửi kèm.",
                files: [
                  { name: "trang-chu-v3-mobile.png", hint: "thiết kế trang chủ mới bản mobile, banner nhà lúc hoàng hôn, nút Gửi ảnh báo giá" }
                ]
              },
              { by: "minh", at: 6, text: "Em cần bản chốt trước thứ 5 để ráp code, trễ nữa là launch 15/10 rất sát." },
              {
                by: "an",
                at: 8.6,
                text: "@{boss} em sửa xong hết góp ý rồi, anh xem và duyệt giúp em trong hôm nay nha 🙏",
                replies: [{ by: "linh", at: 8.8, text: "Chị xem rồi, ổn hơn bản trước nhiều. Chờ anh chốt thôi." }]
              }
            ]
          },
          {
            title: "Gallery before/after dạng thanh trượt cho từng dịch vụ",
            desc: L(
              "Mỗi trang dịch vụ có 1 khối before/after kéo thanh trượt: HDR, thay trời, day-to-dusk, virtual staging, xoá vật thể, cắt nền sản phẩm.",
              "",
              "**Lưu ý:** chỉ dùng ảnh tự chụp hoặc ảnh có giấy phép, KHÔNG dùng ảnh của khách."
            ),
            priority: "high",
            creator: "boss",
            assignees: ["an", "minh"],
            status: "Đang làm",
            due: "tomorrow",
            createdDaysAgo: 14,
            files: [
              { name: "before-after-sky-replacement-demo.jpg", hint: "ảnh demo before/after thay bầu trời cho căn nhà phố, ảnh tự chụp" }
            ],
            subtasks: [
              { title: "Chọn 24 cặp ảnh demo (4 cặp mỗi dịch vụ)", assignees: ["an"], status: "Xong" },
              { title: "Xuất ảnh WebP 1600px, mỗi ảnh dưới 300KB", assignees: ["an"], status: "Xong" },
              { title: "Code thanh trượt, hỗ trợ vuốt trên điện thoại", assignees: ["minh"], status: "Đang làm" },
              { title: "Kiểm tra hiển thị trên iPhone và Android", assignees: ["an"], status: "Backlog" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.1,
                text: "Gallery là chỗ khách nước ngoài xem đầu tiên, làm thật đẹp nhé. @{an} chọn ảnh xong gửi anh xem trước."
              },
              {
                by: "an",
                at: 6,
                text: "Em chọn xong 24 cặp, có 4 cặp tự chụp ở văn phòng cho phần xoá vật thể.",
                replies: [{ by: "boss", at: 6.3, text: "Ok, cặp thay trời số 3 đẹp nhất, để lên đầu." }]
              },
              { by: "minh", at: 12.5, text: "Thanh trượt chạy ổn trên desktop, đang xử lý vụ vuốt trên iPhone bị cuộn luôn cả trang." }
            ]
          },
          {
            title: "Form yêu cầu báo giá: upload ảnh mẫu và chọn dịch vụ",
            desc: L(
              "## Yêu cầu",
              "[x] Chọn dịch vụ (nhiều lựa chọn)",
              "[x] Upload tối đa 10 ảnh mẫu, mỗi ảnh ≤ 25MB",
              "[ ] Số ảnh dự kiến mỗi tháng, thời gian trả ảnh mong muốn",
              "[ ] Gửi thông báo về cho bên account",
              "[ ] Trang cảm ơn bản EN/JA",
              "",
              "Không hiển thị giá trên form, bên account báo giá riêng."
            ),
            priority: "high",
            creator: "linh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 12,
            subtasks: [
              { title: "Thiết kế giao diện form", assignees: ["an"], status: "Xong" },
              { title: "Lưu ảnh mẫu vào bộ nhớ riêng, tự xoá sau 90 ngày", assignees: ["minh"], status: "Đang làm" },
              { title: "Gửi thông báo yêu cầu báo giá mới cho account", assignees: ["minh"], status: "Backlog" }
            ],
            comments: [
              {
                by: "linh",
                at: 3,
                text: "Thêm ô “Quốc gia” và “Múi giờ” giúp chị, bên account cần để xếp ca trả ảnh.",
                replies: [{ by: "minh", at: 3.2, text: "Dạ ok chị, em làm dạng chọn từ danh sách." }]
              },
              { by: "boss", at: 9, text: "Form phải gửi được trên điện thoại nhé, khách Úc hay gửi ảnh từ điện thoại lắm." }
            ]
          },
          {
            title: "Chống spam cho form báo giá (honeypot + giới hạn tần suất)",
            desc: "Form công khai sau launch chắc chắn bị spam. Thêm trường ẩn (honeypot), giới hạn 3 lần gửi/10 phút mỗi IP, chặn file không phải ảnh.",
            priority: "normal",
            creator: "minh",
            assignees: [],
            status: "Backlog",
            due: "later",
            createdDaysAgo: 4
          },
          {
            title: "Tối ưu tốc độ trang: WebP, lazy-load, PageSpeed mobile từ 85 trở lên",
            desc: L(
              "Mục tiêu: PageSpeed mobile ≥ 85, trang chủ tải dưới 2,5 giây trên 4G.",
              "",
              "- Ảnh chuyển WebP, có `srcset` theo kích thước màn hình",
              "- Lazy-load ảnh gallery bên dưới màn hình đầu",
              "- Gộp và nén CSS/JS, bỏ thư viện slider cũ",
              "",
              "Đo lần 1: mobile 54, desktop 81."
            ),
            priority: "high",
            creator: "minh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 6,
            subtasks: [
              { title: "Chuyển ảnh sang WebP + srcset", assignees: ["minh"], status: "Xong" },
              { title: "Lazy-load ảnh gallery", assignees: ["minh"], status: "Đang làm" }
            ],
            comments: [
              {
                by: "minh",
                at: 3,
                text: "Đo lần 2: mobile 78, desktop 94. Còn chậm do font tải từ bên ngoài, em sẽ tự host font.",
                replies: [{ by: "an", at: 3.2, text: "Font tiêu đề em có file gốc, để em gửi anh." }]
              },
              { by: "boss", at: 4, text: "Tốt, cố lên 85 trước launch nhé." }
            ]
          },
          {
            title: "Viết title và meta description cho 8 trang dịch vụ",
            priority: "normal",
            creator: "an",
            assignees: ["an"],
            status: "Review",
            due: "today",
            createdDaysAgo: 10,
            comments: [
              {
                by: "an",
                at: 7,
                text: "Em viết xong title + meta cho 8 trang dịch vụ bản VI/EN, @{linh} chị xem giúp em phần EN ạ.",
                replies: [
                  {
                    by: "linh",
                    at: 8.5,
                    text: "Chị sửa vài chỗ trong file rồi. Trang virtual staging nên nhấn mạnh trả ảnh trong 24h."
                  }
                ]
              }
            ]
          },
          {
            title: "Dịch nội dung website sang tiếng Anh",
            priority: "normal",
            assignees: ["an"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 20
          },
          {
            title: "Dịch nội dung website sang tiếng Nhật và nhờ người bản xứ soát",
            desc: "Ưu tiên trang chủ, trang cắt nền sản phẩm và form báo giá vì đang làm thử với khách Nhật mới.",
            priority: "high",
            creator: "linh",
            assignees: ["an", "linh"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 15,
            comments: [
              { by: "linh", at: 2, text: "Chị nhờ được cộng tác viên người Nhật soát bản dịch, An gửi file trước thứ 4 nhé." },
              {
                by: "an",
                at: 9,
                text: "Em gửi bản dịch máy đã chỉnh tay rồi chị ơi, còn trang Giới thiệu chưa xong.",
                replies: [
                  {
                    by: "linh",
                    at: 11,
                    text: "Bạn soát góp ý: từ chuyên ngành như “cắt nền” nên dùng cách nói quen thuộc với bên Nhật. Chị gửi lại file có ghi chú."
                  }
                ]
              },
              { by: "an", at: 14.4, text: "Đã cập nhật theo góp ý, còn 2 trang chờ soát lần 2." }
            ]
          },
          {
            title: "Duyệt nội dung trang Giới thiệu bản EN/JA",
            priority: "normal",
            creator: "an",
            assignees: ["boss"],
            status: "Review",
            due: "today",
            createdDaysAgo: 3,
            comments: [
              {
                by: "an",
                at: 0.1,
                text: "@{boss} nội dung trang Giới thiệu bản EN và JA em để trong [tài liệu này](https://nesso.example/docs/gioi-thieu-en-ja), anh duyệt giúp em ạ."
              },
              {
                by: "boss",
                at: 2.9,
                text: "Phần EN anh đọc rồi, ok. Phần JA chờ chị Linh xác nhận với bạn soát dịch rồi anh chốt luôn tối nay."
              }
            ]
          },
          {
            title: "Thiết kế bộ icon dịch vụ mới (HDR, thay trời, virtual staging…)",
            priority: "normal",
            creator: "an",
            assignees: ["an"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 25,
            comments: [
              {
                by: "hanh",
                at: 2,
                text: "An ơi icon virtual staging hơi giống icon nội thất chung, thêm chi tiết ghế sofa cho dễ nhận ra được không ạ?",
                replies: [{ by: "an", at: 2.2, text: "Ý hay, để mình thêm nha." }]
              }
            ]
          },
          {
            title: "Chuyển hosting, cài SSL và redirect 301 từ URL cũ",
            desc: "Website mới chạy trên hosting mới, bắt buộc https. Giữ site cũ thêm 2 tuần để phòng khi phải quay lại.",
            priority: "high",
            creator: "minh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 7,
            subtasks: [
              { title: "Lập bảng redirect 301 (khoảng 60 URL cũ)", assignees: ["minh"], status: "Đang làm" },
              { title: "Cài SSL trên hosting mới", assignees: ["minh"], status: "Backlog" },
              { title: "Chuyển DNS tối 14/10 sau 22h", assignees: ["minh"], status: "Backlog", due: "week" }
            ],
            comments: [
              {
                by: "minh",
                at: 2,
                text: "Em chọn chuyển DNS tối 14/10 sau 22h cho ít người truy cập, sáng 15/10 kiểm tra xong mới công bố.",
                replies: [
                  { by: "boss", at: 2.5, text: "Đồng ý. Có phương án quay lại site cũ nếu lỗi không em?" },
                  { by: "minh", at: 2.6, text: "Dạ có, site cũ em giữ nguyên trên hosting cũ thêm 2 tuần." }
                ]
              }
            ]
          },
          {
            title: "Kiểm thử website trên iPhone, Android, Safari, Edge trước launch",
            desc: L(
              "[ ] iPhone (Safari): trang chủ, gallery, form báo giá",
              "[ ] Android (Chrome)",
              "[ ] Máy tính: Chrome, Edge, Safari",
              "[ ] Gửi thử form báo giá kèm 10 ảnh",
              "[ ] Bản EN/JA không vỡ chữ, không tràn nút"
            ),
            priority: "normal",
            creator: "minh",
            assignees: ["khoa", "an"],
            status: "Backlog",
            due: "week",
            createdDaysAgo: 2
          },
          {
            title: "Viết 3 bài blog chuẩn SEO về HDR, virtual staging và day-to-dusk",
            priority: "low",
            creator: "an",
            assignees: ["an"],
            status: "Backlog",
            due: "later",
            createdDaysAgo: 11
          },
          {
            title: "Chốt sitemap và wireframe website mới",
            priority: "normal",
            creator: "minh",
            assignees: ["an", "minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 38
          },
          {
            title: "Thêm trang Tuyển dụng kèm form nộp hồ sơ và bài test",
            desc: "Đợt tuyển tháng 10 cần 6 retoucher. Trang gồm mô tả công việc, các ca làm, quyền lợi và form nộp CV + 3 ảnh bài test.",
            priority: "normal",
            creator: "linh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "next_week",
            createdDaysAgo: 5
          },
          {
            title: "Popup chat trực tuyến ở góc phải website",
            priority: "low",
            creator: "an",
            status: "Huỷ",
            due: "none",
            createdDaysAgo: 18,
            trash: true
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Nesso Work (nội bộ)",
        description: "Cấu hình và triển khai Nesso Work cho toàn công ty: dự án, kênh chat, phân quyền, hướng dẫn, góp ý cải tiến.",
        color: "violet",
        tasks: [
          {
            title: "Tạo cấu trúc dự án và danh sách cho từng phòng ban",
            priority: "normal",
            creator: "minh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 45,
            subtasks: [
              { title: "Dự án Vận hành, CSKH, Marketing", assignees: ["minh"], status: "Xong" },
              { title: "Dự án Website & Hệ thống nội bộ", assignees: ["minh"], status: "Xong" },
              { title: "Mẫu trạng thái chung cho các dự án", assignees: ["minh"], status: "Xong" }
            ],
            comments: [
              {
                by: "boss",
                at: 0.5,
                text: "Làm gọn thôi em, ban đầu mỗi phòng 1 dự án, chia nhỏ quá mọi người rối.",
                replies: [{ by: "minh", at: 0.6, text: "Dạ anh." }]
              }
            ]
          },
          {
            title: "Tạo kênh chat thay cho các nhóm Zalo cũ",
            priority: "normal",
            creator: "minh",
            assignees: ["minh", "admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 45,
            comments: [
              {
                by: "admin",
                at: 0.3,
                text: "Kênh đề xuất: chung, thong-bao, san-xuat, qc-chat-luong, marketing, it-ho-tro, tan-gau. Kênh ban điều hành và leader để riêng tư.",
                replies: [
                  { by: "boss", at: 0.5, text: "Ok. Từ 1/9 thông báo chính thức chỉ đăng trên thong-bao, nhóm Zalo cũ để đọc thôi." },
                  { by: "linh", at: 0.6, text: "Chị nhắc các trưởng ca chuyển hết trao đổi đơn qua san-xuat nhé." }
                ]
              }
            ]
          },
          {
            title: "Phân quyền dự án: Quản lý / Thành viên / Chỉ xem theo phòng ban",
            desc: L(
              "- **Quản lý:** trưởng phòng, trưởng ca, anh giám đốc",
              "- **Thành viên:** người trực tiếp làm việc trong dự án",
              "- **Chỉ xem:** bộ phận liên quan cần theo dõi (vd. account xem dự án IT)",
              "",
              "Dự án riêng tư (ngân sách, nhân sự) chỉ mời đúng người."
            ),
            priority: "high",
            creator: "minh",
            assignees: ["minh", "admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 44
          },
          {
            title: "Import dữ liệu Excel theo dõi đơn cũ (tháng 6–8) vào Nesso Work",
            priority: "normal",
            creator: "linh",
            assignees: ["minh"],
            status: "Huỷ",
            createdDaysAgo: 40,
            comments: [
              {
                by: "minh",
                at: 1,
                text: "File Excel cũ khoảng 3.200 dòng, nhiều cột gộp ô và ghi chú tay, import tự động sẽ lỗi nhiều. Ước tính mất 3–4 ngày làm sạch."
              },
              {
                by: "boss",
                at: 1.5,
                text: "Không đáng. Dữ liệu cũ chỉ để tra cứu, lưu file lên NAS là đủ, từ 25/8 làm mới trên Nesso Work.",
                replies: [
                  { by: "linh", at: 1.6, text: "Đồng ý anh, chị để file ở `\\\\NAS-01\\VanHanh\\LuuTru` cho ai cần tra." },
                  { by: "minh", at: 1.7, text: "Vậy em chuyển ticket sang Huỷ nhé." }
                ]
              }
            ]
          },
          {
            title: "Viết hướng dẫn sử dụng Nesso Work bản 1 trang cho sản xuất",
            priority: "normal",
            creator: "minh",
            assignees: ["minh", "an"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 42,
            files: [
              { name: "huong-dan-nesso-work-1-trang.pdf", hint: "hướng dẫn 1 trang: xem task của tôi, đổi trạng thái, bình luận, đính kèm ảnh" }
            ]
          },
          {
            title: "Quay video ngắn hướng dẫn tạo task, bình luận, đính kèm ảnh",
            priority: "low",
            creator: "minh",
            assignees: ["an"],
            status: "Review",
            due: "none",
            createdDaysAgo: 8
          },
          {
            title: "Tổng hợp góp ý cải tiến Nesso Work tháng 9",
            desc: L(
              "Gom góp ý từ kênh it-ho-tro và khảo sát nhanh cuối tháng 9:",
              "",
              "1. Thông báo điện thoại đến trễ (đã có ticket)",
              "2. Tìm có dấu và không dấu cho kết quả khác nhau",
              "3. Muốn lọc “Của tôi” theo hạn chót mặc định",
              "4. Ảnh HEIC từ iPhone không upload được",
              "5. Muốn ghim bình luận quan trọng trong task",
              "",
              "Xong thì xếp ưu tiên với @{boss} và chị @{linh}."
            ),
            priority: "normal",
            creator: "minh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "overdue",
            createdDaysAgo: 12,
            comments: [
              {
                by: "lead1",
                at: 1,
                text: "Thêm giúp anh: trưởng ca muốn xem nhanh mỗi người đang có bao nhiêu task mở trong ngày.",
                replies: [{ by: "minh", at: 1.3, text: "Ghi nhận anh, em thêm mục 6." }]
              },
              { by: "khoa", at: 2, text: "QC muốn có task lặp lại hằng tuần (báo cáo năng suất) cho đỡ tạo tay." },
              {
                by: "boss",
                at: 8,
                text: "@{minh} tổng hợp xong chưa em? Thứ 2 họp chốt ưu tiên Q4.",
                replies: [{ by: "minh", at: 8.2, text: "Dạ còn thiếu góp ý bên account, cuối tuần em gửi anh ạ." }]
              }
            ]
          },
          {
            title: "Thêm trạng thái “Chờ khách phản hồi” cho dự án CSKH",
            priority: "low",
            creator: "linh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 16
          },
          {
            title: "Đào tạo nhanh Nesso Work cho 6 retoucher mới (đợt tuyển tháng 10)",
            desc: L(
              "Dự kiến 6 bạn mới vào làm từ 19/10.",
              "",
              "- Buổi 1 (45 phút): xem “Của tôi”, đổi trạng thái, bình luận kèm ảnh",
              "- Buổi 2: kênh san-xuat, qc-chat-luong, cách nhắc tên trưởng ca",
              "",
              "Tài liệu: [hướng dẫn 1 trang](https://nesso.example/docs/huong-dan-1-trang)"
            ),
            priority: "normal",
            creator: "linh",
            assignees: ["minh", "admin"],
            status: "Backlog",
            due: "next_week",
            createdDaysAgo: 4
          },
          {
            title: "Khoá tài khoản nhân sự nghỉ việc và chuyển giao task",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 29,
            subtasks: [
              { title: "Khoá tài khoản Lộc sau ngày làm cuối 12/9, chuyển task cho trưởng ca A", assignees: ["admin"], status: "Xong" },
              { title: "Khoá tài khoản Hạnh khi kết thúc thực tập 30/9", assignees: ["admin"], status: "Xong" }
            ],
            comments: [
              {
                by: "admin",
                at: 1,
                text: "Task đang mở của Lộc đã chuyển hết cho @{lead1}, file cá nhân trên NAS gom về thư mục bàn giao.",
                replies: [{ by: "lead1", at: 1.2, text: "Anh nhận rồi nhé." }]
              }
            ]
          },
          {
            title: "Thiết lập nhắc hạn chót tự động qua thông báo",
            priority: "normal",
            creator: "linh",
            assignees: [],
            status: "Backlog",
            due: "none",
            createdDaysAgo: 6
          },
          {
            title: "Góp ý: thêm chế độ tối cho ứng dụng điện thoại",
            priority: "low",
            creator: "khoa",
            assignees: [],
            status: "Backlog",
            due: "none",
            createdDaysAgo: 10
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Hạ tầng & mạng",
        description: "NAS, backup, mạng, UPS, camera, license phần mềm và thiết bị cho nhân sự.",
        color: "sky",
        tasks: [
          {
            title: "Phê duyệt mua NAS mới 8 bay cho sản xuất",
            desc: L(
              "NAS-01 đã dùng 91% dung lượng, 2 ổ báo lỗi SMART trong tháng 8.",
              "",
              "Đề xuất: NAS 8 bay, 8 ổ 16TB chạy RAID 6, 2 cổng mạng 10GbE. Cấu hình chi tiết và báo giá em gửi trong nhóm tài chính.",
              "",
              "@{boss} anh duyệt giúp em để kịp chuyển đổi trước cao điểm."
            ),
            priority: "high",
            creator: "minh",
            assignees: ["boss"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 40,
            comments: [
              {
                by: "boss",
                at: 1,
                text: "Cần thiết. Tính phương án sao lưu chưa em? Mua NAS mà không có backup thì cũng như không.",
                replies: [
                  {
                    by: "minh",
                    at: 1.2,
                    text: "Dạ có, NAS cũ sau khi chuyển sẽ làm máy backup, thêm 1 gói lưu trữ đám mây cho dữ liệu quan trọng ạ."
                  }
                ]
              },
              {
                by: "boss",
                at: 2,
                text: "Ok duyệt. Chị Linh làm thủ tục mua giúp anh.",
                replies: [{ by: "linh", at: 2.1, text: "Dạ chiều nay chị đặt hàng." }]
              }
            ]
          },
          {
            title: "Thiết lập backup 3-2-1 cho NAS-02 (NAS-BK + lưu trữ đám mây)",
            desc: L(
              "**3-2-1:** 3 bản dữ liệu, 2 loại thiết bị, 1 bản ngoài văn phòng.",
              "",
              "- Lịch đồng bộ: `Retouch\\Delivered` → NAS-BK lúc 23:00 hằng ngày",
              "- Giữ 30 phiên bản cho thư mục Vận hành và Kế toán",
              "- Bản ngoài văn phòng phải mã hoá trước khi đẩy lên đám mây"
            ),
            priority: "urgent",
            creator: "minh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "overdue",
            createdDaysAgo: 18,
            subtasks: [
              { title: "Cài lại NAS-01 làm NAS-BK", assignees: ["minh"], status: "Xong" },
              { title: "Đồng bộ đám mây cho thư mục Vận hành, Kế toán", assignees: ["minh"], status: "Đang làm" },
              { title: "Viết tài liệu khôi phục dữ liệu", assignees: ["minh"], status: "Backlog" }
            ],
            comments: [
              { by: "boss", at: 3, text: "Backup quan trọng hơn mọi việc khác bên IT. Hạn 5/10 nhé em." },
              {
                by: "minh",
                at: 12,
                text: "NAS-BK chạy được 1 tuần, job đêm qua thành công. Phần đám mây đang chờ chị @{linh} duyệt gói lưu trữ.",
                replies: [
                  { by: "linh", at: 13, text: "Chị duyệt rồi nha, @{admin} làm thủ tục thanh toán giúp chị." },
                  { by: "admin", at: 13.5, text: "Ok chị, mai em xử lý." }
                ]
              }
            ]
          },
          {
            title: "Khôi phục thử từ bản backup định kỳ hằng tháng",
            priority: "normal",
            creator: "minh",
            assignees: ["minh", "admin"],
            status: "Backlog",
            due: "later",
            createdDaysAgo: 9
          },
          {
            title: "Duyệt ngân sách thay UPS phòng server",
            desc: "UPS hiện tại đã 5 năm, pin chai (xem ticket UPS kêu bíp 28/9). Em so sánh 3 phương án trong file, đề xuất phương án 2: UPS online 3kVA, giữ được khoảng 20 phút cho NAS + switch.",
            priority: "high",
            creator: "minh",
            assignees: ["boss"],
            status: "Review",
            due: "overdue",
            createdDaysAgo: 11,
            files: [
              { name: "so-sanh-ups-3-phuong-an.xlsx", hint: "bảng so sánh 3 phương án UPS: công suất, thời gian lưu điện, bảo hành" }
            ],
            comments: [
              {
                by: "boss",
                at: 2,
                text: "Phương án 2 ok, hỏi thêm bên bán có gói thay pin định kỳ không.",
                replies: [{ by: "minh", at: 3, text: "Dạ có gói thay pin sau 3 năm, em cập nhật vào file rồi anh." }]
              },
              {
                by: "minh",
                at: 9.6,
                text: "@{boss} anh duyệt giúp em trong tuần này nhé, mùa mưa điện chập chờn, UPS cũ giờ chỉ giữ được 4 phút.",
                edited:
                  "@{boss} anh duyệt giúp em trong tuần này nhé, mùa mưa điện hay chập chờn, UPS cũ giờ chỉ giữ được khoảng 4 phút.",
                replies: [{ by: "boss", at: 10.4, text: "Ok, thứ 2 anh ký nhé." }]
              }
            ]
          },
          {
            title: "Thay switch 24 port tầng 2, đi lại dây mạng khu sản xuất",
            desc: "Switch cũ chỉ 1Gbps, đã chết 3 cổng. Thay loại 24 port có 2 cổng 10GbE nối thẳng NAS-02, đi lại dây và dán nhãn từng ổ mạng. Làm vào Chủ nhật để không ảnh hưởng ca.",
            priority: "normal",
            creator: "minh",
            assignees: ["minh"],
            status: "Đang làm",
            due: "next_week",
            createdDaysAgo: 13
          },
          {
            title: "Lắp thêm 2 camera khu để xe và cửa sau",
            priority: "low",
            creator: "admin",
            assignees: ["admin"],
            status: "Backlog",
            due: "none",
            createdDaysAgo: 16
          },
          {
            title: "Rà soát license Photoshop/Lightroom, gom về tài khoản công ty",
            desc: L(
              "Sau vụ hết bản quyền 30/9, rà lại toàn bộ:",
              "",
              "- Máy nào dùng license nào, gia hạn ngày nào",
              "- Gom về 1 tài khoản quản trị của công ty, bỏ gia hạn đứng tên cá nhân",
              "- Đặt nhắc gia hạn trước 30 ngày",
              "",
              "File theo dõi: [Danh sách license](https://nesso.example/files/license-tracker)"
            ),
            priority: "high",
            creator: "linh",
            assignees: ["admin", "minh"],
            status: "Đang làm",
            due: "later",
            createdDaysAgo: 10,
            comments: [
              {
                by: "admin",
                at: 2,
                text: "Thống kê xong 31 máy, có 4 license còn đứng tên nhân viên cũ.",
                replies: [{ by: "minh", at: 2.3, text: "Em chuyển 4 máy đó trong tuần, phải đăng nhập lại từng máy." }]
              },
              { by: "linh", at: 5, text: "Năm sau gom gia hạn về 1 đợt vào tháng 1 cho dễ theo dõi chi phí nhé." }
            ]
          },
          {
            title: "Mua 2 laptop cho bên account xử lý đơn ngoài giờ",
            desc: "Cấu hình tối thiểu: màn 14 inch, RAM 16GB, SSD 512GB. Cài sẵn VPN, Nesso Work và phần mềm xem ảnh RAW.",
            priority: "normal",
            creator: "boss",
            assignees: ["admin"],
            status: "Review",
            due: "next_week",
            createdDaysAgo: 7,
            comments: [
              {
                by: "boss",
                at: 0.05,
                text: "Account hay phải trả lời khách Úc lúc 5–6h sáng, cấp 2 laptop để làm ở nhà, cài sẵn VPN và Nesso Work."
              },
              {
                by: "admin",
                at: 2,
                text: "Em gửi 2 cấu hình đề xuất: màn 14 inch, RAM 16GB, đủ cho email, chat và xem ảnh.",
                replies: [
                  { by: "boss", at: 3, text: "Lấy loại màn hình chuẩn màu hơn chút, account đôi khi phải xem ảnh trước khi trả khách." }
                ]
              }
            ]
          },
          {
            title: "Nâng RAM 32GB lên 64GB cho 6 máy ghép HDR",
            priority: "high",
            creator: "lead1",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 22,
            comments: [
              {
                by: "lead1",
                at: 0.1,
                text: "Đợt rush này máy ghép HDR 7 bracket chạy ì quá, nâng RAM được không em?",
                replies: [
                  {
                    by: "minh",
                    at: 1,
                    text: "Lắp xong 6 máy tối qua rồi, mọi người mở lại Photoshop và chỉnh mức RAM sử dụng lên 80% nhé."
                  }
                ]
              }
            ]
          },
          {
            title: "Cấu hình VLAN riêng cho camera và wifi khách",
            priority: "low",
            creator: "minh",
            assignees: [],
            status: "Backlog",
            due: "none",
            createdDaysAgo: 20
          },
          {
            title: "Chuẩn bị 6 máy trạm cho retoucher mới",
            priority: "high",
            creator: "linh",
            assignees: ["minh", "admin"],
            status: "Đang làm",
            due: "week",
            createdDaysAgo: 4,
            subtasks: [
              { title: "Cài Windows, Photoshop, Lightroom và bộ action chuẩn", assignees: ["minh"], status: "Đang làm" },
              { title: "Hiệu chuẩn màu 6 màn hình mới", assignees: ["khoa"], status: "Backlog" },
              { title: "Tạo tài khoản Nesso Work và quyền NAS cho nhóm mới", assignees: ["admin"], status: "Backlog" },
              { title: "Dán nhãn máy PC-SX-19 đến PC-SX-24", assignees: ["admin"], status: "Xong" }
            ],
            comments: [
              {
                by: "admin",
                at: 1,
                text: "6 máy giao đủ rồi, đang để tạm ở phòng kho tầng 2.",
                replies: [{ by: "minh", at: 1.2, text: "Ok, mai em bắt đầu cài." }]
              }
            ]
          },
          {
            title: "Gia hạn tên miền và chứng chỉ SSL website hiện tại",
            priority: "normal",
            creator: "admin",
            assignees: ["admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 30
          },
          {
            title: "Hiệu chuẩn màu màn hình định kỳ cho phòng QC",
            priority: "normal",
            creator: "khoa",
            assignees: ["khoa", "minh"],
            status: "Đang làm",
            due: "later",
            createdDaysAgo: 6
          },
          {
            title: "Thử ổ SSD riêng làm scratch disk cho Photoshop",
            priority: "normal",
            creator: "minh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 21
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Chuyển đổi NAS cũ",
        description: "Chuyển NAS-01 sang NAS-02 cuối tuần 19–20/9. Đã hoàn tất, lưu trữ.",
        color: "slate",
        archived: true,
        tasks: [
          {
            title: "Kế hoạch chuyển NAS-01 sang NAS-02 cuối tuần 19–20/9",
            desc: L(
              "## Lịch",
              "- **T7 19/9 12:00:** khoá ghi NAS-01, sản xuất lưu tạm ổ D:",
              "- **T7 19/9 13:00 → CN 20/9:** copy dữ liệu, ánh xạ quyền",
              "- **CN 20/9 18:00:** kiểm tra checksum, đổi ổ mạng",
              "- **T2 21/9 07:00:** mở lại cho ca sáng",
              "",
              "Trực: @{minh}, @{admin}. Liên hệ khẩn qua kênh it-ho-tro."
            ),
            priority: "high",
            creator: "minh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 30,
            subtasks: [
              { title: "Chốt lịch dừng NAS với chị Linh và trưởng ca", assignees: ["minh"], status: "Xong" },
              { title: "Chuẩn bị ổ cứng tạm cho ca trực cuối tuần", assignees: ["admin"], status: "Xong" }
            ],
            comments: [
              {
                by: "boss",
                at: 1,
                text: "Cuối tuần đó vẫn còn đuôi đợt rush, nhớ chừa thư mục Input đơn Úc cho ca đêm nhé.",
                replies: [
                  { by: "minh", at: 1.2, text: "Dạ em copy `Input` trước, ca đêm làm trên NAS-02 từ tối thứ 7 luôn." },
                  { by: "linh", at: 1.5, text: "Chị báo các trưởng ca rồi." }
                ]
              }
            ]
          },
          {
            title: "Thông báo lịch dừng truy cập NAS cho sản xuất và account",
            priority: "normal",
            creator: "minh",
            assignees: ["admin", "linh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 27
          },
          {
            title: "Copy dữ liệu \\Retouch\\Archive (khoảng 18TB) sang NAS-02",
            priority: "urgent",
            creator: "minh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 22,
            files: [{ name: "log-nas-02-20-09.txt", hint: "log copy dữ liệu Archive sang NAS-02 đêm 19–20/9, 18.2TB, 0 lỗi" }],
            comments: [
              { by: "minh", at: 1.6, text: "23:40 copy được 11TB, tốc độ trung bình 480MB/s. Dự kiến xong khoảng 5h sáng." },
              {
                by: "minh",
                at: 2.3,
                text: "Xong 18.2TB, 0 lỗi. Đang chạy kiểm tra checksum.",
                replies: [{ by: "boss", at: 2.4, text: "Vất vả rồi em 👍 nghỉ ngơi chút đi." }]
              }
            ]
          },
          {
            title: "Ánh xạ lại quyền thư mục theo nhóm A/B/QC/Account",
            priority: "high",
            creator: "minh",
            assignees: ["minh"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 22
          },
          {
            title: "Cập nhật đường dẫn ổ mạng trên các máy trạm",
            priority: "normal",
            creator: "minh",
            assignees: ["minh", "admin"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 21
          },
          {
            title: "Kiểm tra checksum và nghiệm thu dữ liệu sau chuyển đổi",
            priority: "normal",
            creator: "minh",
            assignees: ["minh", "khoa"],
            status: "Xong",
            due: "past",
            createdDaysAgo: 20
          }
        ]
      }
    ]
  },

  // ===================================================================================================
  // QT — Cải tiến quy trình retouch
  // ===================================================================================================
  {
    key: "QT",
    name: "Cải tiến quy trình retouch",
    description:
      "Chuẩn hoá và cải tiến quy trình chỉnh ảnh: checklist QC, action/preset Photoshop, style guide theo nhóm khách, đo năng suất. Ý tưởng mới tạo task ở trạng thái Đề xuất.",
    icon: "workflow",
    color: "teal",
    visibility: "public",
    owner: "khoa",
    members: {
      khoa: "manage",
      boss: "manage",
      linh: "manage",
      lead1: "manage",
      lead2: "submit",
      nv01: "submit",
      nv02: "submit",
      nv03: "submit",
      nv04: "submit",
      nv05: "submit",
      nv06: "submit",
      nv07: "submit",
      nv08: "submit",
      nv09: "submit",
      nv10: "submit",
      nv11: "submit",
      nv12: "submit",
      nv13: "submit",
      nv14: "view",
      nv15: "view"
    },
    workflow: qtFlow,
    createdOn: "2026-08-28",
    lists: [
      // ---------------------------------------------------------------------------------------------
      {
        name: "Checklist QC",
        description: "Checklist QC v2 (áp dụng từ 05/10) và các lỗi hay gặp cần xử lý triệt để.",
        color: "teal",
        tasks: [
          {
            title: "Chốt checklist QC v2 (áp dụng từ 05/10)",
            desc: L(
              "Checklist v2 gom từ lỗi QC fail đợt rush 14–19/9. Retoucher tự kiểm từng ảnh trước khi đẩy sang QC:",
              "",
              "[x] Cửa sổ: cảnh ngoài rõ, không halo, không viền trắng",
              "[x] Bầu trời: không quầng sáng quanh mái, cây; màu trời theo style guide khách",
              "[x] Cân bằng trắng đồng nhất giữa các phòng",
              "[x] Đường dọc thẳng (tường, khung cửa, tủ)",
              "[x] Xoá vật thể sạch, không lặp texture",
              "[x] Xuất file đúng kích thước, hệ màu, tên file",
              "",
              "@{boss} anh chốt giúp em bản này để 5/10 áp dụng."
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["boss", "khoa"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 14,
            files: [
              { name: "checklist-qc-v2.pdf", hint: "checklist QC v2 một trang: cửa sổ, bầu trời, cân bằng trắng, đường dọc, xuất file" }
            ],
            subtasks: [
              { title: "Soạn bản nháp từ danh sách lỗi đợt rush", assignees: ["khoa"], status: "Hoàn tất" },
              { title: "Lấy góp ý của 2 trưởng ca", assignees: ["lead1", "lead2"], status: "Hoàn tất" },
              { title: "In và dán checklist tại từng bàn", assignees: ["lead2"], status: "Hoàn tất" }
            ],
            comments: [
              {
                by: "lead1",
                at: 2,
                text: "Thêm mục kiểm tra tên file giúp anh, tuần rồi có 2 đơn trả sai tên phải đổi lại.",
                replies: [{ by: "khoa", at: 2.2, text: "Ok, em gộp vào mục xuất file." }]
              },
              {
                by: "lead2",
                at: 3,
                text: "Ca đêm làm đơn gấp, checklist dài quá sợ các bạn bỏ qua. Có bản rút gọn không?",
                replies: [
                  { by: "khoa", at: 3.3, text: "Bản in chỉ 1 trang, mỗi mục 1 dòng thôi anh. Em làm thêm bản thẻ dán cạnh màn hình." }
                ]
              },
              {
                by: "boss",
                at: 8,
                text: "Anh đọc rồi. Ok chốt bản này, 5/10 áp dụng. Sau 2 tuần báo cáo tỷ lệ QC fail trước/sau cho anh.",
                edited:
                  "Anh đọc rồi. Ok chốt bản này, 5/10 áp dụng cho tất cả các ca. Sau 2 tuần báo cáo tỷ lệ QC fail trước/sau cho anh.",
                replies: [{ by: "khoa", at: 8.1, text: "Dạ anh, em đặt lịch báo cáo ngày 19/10." }]
              }
            ]
          },
          {
            title: "Tổng hợp lỗi QC fail đợt rush 14–19/9",
            desc: L(
              "Tuần rush 14–19/9 tỷ lệ QC fail lên 11,8% (bình thường khoảng 4%). Top lỗi:",
              "",
              "1. Halo bầu trời quanh mái và cây — 31%",
              "2. Kéo cửa sổ bị viền trắng/mờ — 24%",
              "3. Cân bằng trắng lệch giữa các phòng — 17%",
              "4. Đường dọc nghiêng — 12%",
              "5. Sai kích thước/tên file — 9%"
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["khoa", "lead1"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 20,
            files: [
              { name: "qc-fail-dot-rush-14-19-9.xlsx", hint: "bảng tổng hợp lỗi QC fail theo loại lỗi và theo ca, đợt rush 14–19/9" }
            ],
            comments: [
              {
                by: "boss",
                at: 1,
                text: "11,8% là quá cao, 2 khách đã phàn nàn màu trời. Trước Q4 phải có checklist mới.",
                replies: [{ by: "khoa", at: 1.2, text: "Dạ em làm checklist v2 dựa trên bảng này, tuần sau trình anh." }]
              },
              {
                by: "nv04",
                at: 2,
                text: "Em thấy halo chủ yếu do ca đêm mask nhanh cho kịp giờ, không kịp refine viền.",
                replies: [{ by: "lead2", at: 2.3, text: "Đúng vậy, riêng đêm 17/9 ca đêm làm gần 600 ảnh 😓" }]
              }
            ]
          },
          {
            title: "Áp dụng checklist v2 cho ca sáng nhóm A",
            priority: "high",
            creator: "lead1",
            assignees: ["nv01", "nv02", "nv03"],
            status: "Đang áp dụng",
            due: "week",
            createdDaysAgo: 5,
            comments: [
              {
                by: "lead1",
                at: 0.1,
                text: "Từ hôm nay mỗi ảnh tự check theo v2 trước khi đẩy QC. Tuần đầu chậm chút cũng được, quan trọng là đúng."
              },
              {
                by: "nv02",
                at: 2,
                text: "Mục cân bằng trắng em hay quên so giữa các phòng, có cách nào nhanh không anh?",
                replies: [
                  { by: "khoa", at: 2.3, text: "Mở 3–4 ảnh cạnh nhau ở chế độ xem lưới trong Bridge rồi so, mất 10 giây thôi em." }
                ]
              }
            ]
          },
          {
            title: "Áp dụng checklist v2 cho ca chiều nhóm B",
            desc: "Áp dụng từ 5/10. Tuần đầu trưởng ca kiểm ngẫu nhiên 10 ảnh/người/ngày, lỗi ghi vào bình luận task này.",
            priority: "normal",
            creator: "lead2",
            assignees: ["nv07", "nv08", "nv09"],
            status: "Đang áp dụng",
            due: "week",
            createdDaysAgo: 5
          },
          {
            title: "Áp dụng checklist v2 cho ca đêm (đơn Úc/Mỹ)",
            priority: "normal",
            creator: "lead2",
            assignees: ["nv12", "nv13", "lead2"],
            status: "Đang áp dụng",
            due: "none",
            createdDaysAgo: 5
          },
          {
            title: "Lỗi hay gặp: viền cửa sổ bị halo trắng khi kéo cảnh ngoài",
            desc: L(
              "**Nguyên nhân:** mask cửa sổ chọn vùng nhanh, không refine, blend mode sai.",
              "",
              "**Cách làm chuẩn:**",
              "1. Dùng bracket tối nhất cho vùng cửa sổ",
              "2. Tạo mask bằng `Select > Color Range` rồi thu mask 1–2px",
              "3. Feather 0.5px, kiểm tra ở zoom 200%",
              "4. Cảnh ngoài không sáng hơn trong phòng quá 1 stop"
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["khoa", "nv04", "nv05"],
            status: "Đang áp dụng",
            due: "none",
            createdDaysAgo: 17,
            comments: [
              {
                by: "nv05",
                at: 3,
                text: "Cửa sổ có rèm voan thì sao ạ? Color Range chọn dính cả rèm.",
                replies: [
                  {
                    by: "khoa",
                    at: 3.4,
                    text: "Rèm voan thì mask tay phần rèm, giảm opacity cảnh ngoài còn 60–70% cho tự nhiên. Em xem ảnh mẫu trong style guide nhóm A."
                  }
                ]
              },
              { by: "nv04", at: 9, text: "Em làm theo cách mới 1 tuần, ảnh cửa sổ không bị trả về lần nào 💪" }
            ]
          },
          {
            title: "Lỗi hay gặp: halo bầu trời quanh mái nhà và cây",
            desc: L(
              "Lỗi chiếm 31% QC fail đợt rush. Đang thử 2 cách:",
              "",
              "- **Cách 1:** mask trời từ kênh xanh dương + `Refine Edge` cho tán cây",
              "- **Cách 2:** phủ lớp màu trời mờ lên viền (color decontaminate)",
              "",
              "Mỗi bạn thử 30 ảnh, ghi thời gian và số ảnh còn halo vào bảng."
            ),
            priority: "urgent",
            creator: "khoa",
            assignees: ["nv06", "nv10", "nv11"],
            status: "Đang thử nghiệm",
            due: "tomorrow",
            createdDaysAgo: 16,
            files: [
              { name: "before-after-halo-bau-troi.jpg", hint: "so sánh trước/sau: quầng sáng trắng quanh mái nhà và tán cây khi thay trời" }
            ],
            comments: [
              { by: "nv10", at: 4, text: "Cách 1 sạch hơn nhưng với cây nhiều lá mất thêm khoảng 40 giây/ảnh." },
              {
                by: "nv06",
                at: 6,
                text: "Cách 2 nhanh nhưng trời xanh đậm thì viền bị ám xanh lên mái ngói.",
                replies: [
                  {
                    by: "khoa",
                    at: 6.5,
                    text: "Vậy kết hợp: cây dùng cách 1, mái nhà và cạnh thẳng dùng cách 2. Mọi người thử thêm 20 ảnh theo cách kết hợp nhé."
                  }
                ]
              },
              { by: "nv11", at: 14.5, text: "Em thử 20 ảnh kết hợp: còn 1 ảnh halo nhẹ ở cây dừa, còn lại sạch." }
            ]
          },
          {
            title: "Lỗi hay gặp: cân bằng trắng lệch giữa các phòng cùng một căn",
            desc: L(
              "Một căn có phòng đèn vàng, phòng ánh sáng tự nhiên → xem cả bộ thấy lệch tông.",
              "",
              "Đang thử: chọn 1 ảnh phòng khách làm chuẩn, dùng `Match Color` cho các phòng còn lại rồi chỉnh tay ±200K."
            ),
            priority: "normal",
            creator: "khoa",
            assignees: ["nv14", "nv15", "nv01"],
            status: "Đang thử nghiệm",
            due: "next_week",
            createdDaysAgo: 8
          },
          {
            title: "Lỗi hay gặp: đường dọc không thẳng (tường, khung cửa, tủ bếp)",
            priority: "normal",
            creator: "khoa",
            assignees: ["nv02", "nv08", "nv13"],
            status: "Đang áp dụng",
            due: "next_week",
            createdDaysAgo: 12,
            comments: [
              {
                by: "nv08",
                at: 2,
                text: "Ảnh chụp góc rộng 14mm sửa dọc xong bị kéo méo đồ ở mép, có nên crop bớt không anh Khoa?",
                replies: [
                  { by: "khoa", at: 2.5, text: "Crop tối đa 5% mỗi cạnh, nhiều hơn thì ghi chú để account hỏi lại khách." }
                ]
              }
            ]
          },
          {
            title: "Mini-quiz checklist v2 cho toàn bộ retoucher",
            priority: "low",
            creator: "khoa",
            assignees: ["khoa", "nv14", "nv15"],
            status: "Đề xuất",
            due: "later",
            createdDaysAgo: 3
          },
          {
            title: "Checklist riêng cho ảnh sản phẩm cắt nền (khách Nhật làm thử)",
            desc: L(
              "Khách Nhật mới rất khắt khe về viền. Checklist riêng cho đơn thử:",
              "",
              "[ ] Nền trắng tuyệt đối RGB 255/255/255",
              "[ ] Viền sạch, không răng cưa ở zoom 200%",
              "[ ] Giữ bóng đổ tự nhiên khi đơn yêu cầu",
              "[ ] Không sót pixel nền ở lỗ hở (quai túi, dây kéo)",
              "[ ] Kích thước, khoảng cách lề theo file yêu cầu"
            ),
            priority: "urgent",
            creator: "khoa",
            assignees: ["khoa", "nv03", "nv09"],
            status: "Đang thử nghiệm",
            due: "today",
            createdDaysAgo: 4,
            subtasks: [
              { title: "Soạn checklist từ file yêu cầu của khách", assignees: ["khoa"], status: "Hoàn tất" },
              { title: "Áp dụng thử trên 100 ảnh đơn thử", assignees: ["nv03", "nv09"], status: "Đang thử nghiệm", due: "tomorrow" }
            ],
            comments: [
              { by: "khoa", at: 0.3, text: "Đơn thử 100 ảnh trả ngày 13/10, account nói nếu đạt thì khách gửi đều mỗi tuần." },
              {
                by: "nv09",
                at: 2,
                text: "Ảnh túi xách quai mảnh em phải dùng pen tool mới sạch, khoảng 6 phút/ảnh.",
                replies: [{ by: "khoa", at: 2.2, text: "Ok, đơn thử ưu tiên chất lượng, thời gian tính sau." }]
              },
              {
                by: "boss",
                at: 3.7,
                text: "Đơn này quan trọng, khách Nhật ưng là mở được thị trường mới. @{khoa} QC 100% đơn thử giúp anh.",
                replies: [{ by: "khoa", at: 3.8, text: "Dạ anh, em QC từng ảnh." }]
              }
            ]
          },
          {
            title: "Checklist QC v1 (bản tháng 8)",
            priority: "low",
            creator: "khoa",
            assignees: ["khoa"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 43,
            comments: [
              {
                by: "loc",
                at: 2,
                text: "Mục kiểm tra cửa sổ nên ghi rõ zoom bao nhiêu % anh Khoa ơi, mỗi người kiểm một kiểu.",
                replies: [{ by: "khoa", at: 2.3, text: "Ý hay, anh thêm “zoom 100%” vào nhé Lộc." }]
              }
            ]
          },
          {
            title: "Checklist QC v2 (bản nháp trùng)",
            priority: "low",
            creator: "khoa",
            assignees: [],
            status: "Đề xuất",
            due: "none",
            createdDaysAgo: 13,
            trash: true
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Action & preset Photoshop",
        description: "Action, preset, script dùng chung. Bản chuẩn lưu trên NAS-02 thư mục Retouch/Actions, không tự sửa bản chung.",
        color: "violet",
        tasks: [
          {
            title: "Action HDR blend v3: tự căn chỉnh bracket + mask cửa sổ",
            desc: L(
              "Nâng cấp từ v2 (bản Lộc bàn giao):",
              "",
              "- Tự căn chỉnh 3/5/7 bracket",
              "- Tự tạo mask cửa sổ từ bracket tối nhất",
              "- Bỏ bước tăng saturation toàn ảnh (gây trời ám tím)",
              "",
              "Cài đặt: copy `HDR-blend-v3.atn` từ `\\\\NAS-02\\Retouch\\Actions\\Thu-nghiem` rồi Load Actions."
            ),
            priority: "high",
            creator: "lead1",
            assignees: ["lead1", "nv04", "nv06"],
            status: "Đang thử nghiệm",
            due: "week",
            createdDaysAgo: 11,
            files: [{ name: "huong-dan-action-hdr-v3.docx", hint: "hướng dẫn cài và dùng action HDR blend v3, các bước có ảnh minh hoạ" }],
            subtasks: [
              { title: "Ghi action trên bộ ảnh mẫu 5 bracket", assignees: ["lead1"], status: "Hoàn tất" },
              { title: "Viết hướng dẫn cài đặt", assignees: ["nv04"], status: "Hoàn tất" },
              { title: "Thử trên ảnh ngược sáng mạnh", assignees: ["nv06"], status: "Đang thử nghiệm" }
            ],
            comments: [
              {
                by: "nv06",
                at: 3,
                text: "Ảnh ngược sáng mạnh thì mask cửa sổ v3 ăn vào cả khung cửa gỗ ạ.",
                replies: [
                  { by: "lead1", at: 3.4, text: "Anh hạ ngưỡng Color Range từ 40 xuống 28, em thử lại bản `v3.1` nhé." }
                ]
              },
              {
                by: "nv04",
                at: 7,
                text: "Bản v3.1 ổn hơn nhiều, nhanh hơn v2 khoảng 1 phút/ảnh.",
                replies: [
                  { by: "khoa", at: 7.3, text: "Ghi số liệu vào task đo thời gian giúp anh nha, so sánh phải có số." }
                ]
              }
            ]
          },
          {
            title: "Thử action HDR v3 trên 50 ảnh đơn Úc thực tế",
            priority: "normal",
            creator: "lead1",
            assignees: ["nv05", "nv07", "nv10"],
            status: "Đang thử nghiệm",
            due: "week",
            createdDaysAgo: 6,
            comments: [
              {
                by: "nv07",
                at: 2,
                text: "Em xong 20/50 ảnh, 3 ảnh bracket lệch do khách chụp cầm tay, action căn không kịp.",
                replies: [
                  { by: "lead1", at: 2.3, text: "Ảnh cầm tay thì căn chỉnh tay trước rồi chạy phần còn lại của action nhé." }
                ]
              },
              { by: "nv10", at: 4.5, text: "Phần của em xong rồi, em ghi chú trong file theo dõi chung ạ." }
            ]
          },
          {
            title: "Preset Lightroom nội thất: 4 kiểu ánh sáng (ngày, chiều, đèn vàng, u ám)",
            desc: "Preset lưu ở `\\\\NAS-02\\Retouch\\Actions\\Preset-LR`. Chỉ là điểm bắt đầu, vẫn phải chỉnh tay cân bằng trắng từng phòng.",
            priority: "normal",
            creator: "lead2",
            assignees: ["nv11", "nv12", "lead2"],
            status: "Đang áp dụng",
            due: "none",
            createdDaysAgo: 25
          },
          {
            title: "Script đổi tên file theo mẫu: mã đơn_số thứ tự_phiên bản",
            desc: L(
              "Mẫu tên: `MaDon_001_v1.jpg`. Script chạy trong Bridge hoặc Photoshop:",
              "",
              "1. Chọn thư mục ảnh đã xuất",
              "2. Nhập mã đơn",
              "3. Script tự đánh số theo thứ tự chụp và thêm `_v1`",
              "",
              "Khách yêu cầu sửa: tăng lên `_v2`, KHÔNG ghi đè file cũ."
            ),
            priority: "normal",
            creator: "lead2",
            assignees: ["lead2", "nv13", "nv14"],
            status: "Đang áp dụng",
            due: "none",
            createdDaysAgo: 15
          },
          {
            title: "Batch export JPG sRGB 2048px theo yêu cầu từng nhóm khách",
            priority: "normal",
            creator: "lead1",
            assignees: ["nv02", "lead1"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 35
          },
          {
            title: "Action day-to-dusk: trời hoàng hôn + bật đèn cửa sổ",
            priority: "normal",
            creator: "lead2",
            assignees: ["nv08", "nv15", "nv09"],
            status: "Đề xuất",
            due: "later",
            createdDaysAgo: 9
          },
          {
            title: "Gom action dùng chung lên NAS-02 và khoá quyền sửa",
            desc: "Bản chuẩn đặt tại `\\\\NAS-02\\Retouch\\Actions`, chỉ nhóm QC có quyền ghi. Bản thử nghiệm để trong thư mục `Thu-nghiem`.",
            priority: "normal",
            creator: "khoa",
            assignees: ["khoa"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 18
          },
          {
            title: "Action cắt nền sản phẩm + kiểm tra viền ở zoom 200%",
            priority: "urgent",
            creator: "khoa",
            assignees: ["nv03", "nv09", "nv01"],
            status: "Đang thử nghiệm",
            due: "overdue",
            createdDaysAgo: 7,
            subtasks: [
              { title: "Action tạo path tự động cho sản phẩm nền sáng", assignees: ["nv03"], status: "Đang thử nghiệm" },
              { title: "Bước soi viền bằng lớp nền tương phản", assignees: ["nv09"], status: "Hoàn tất" }
            ],
            comments: [
              {
                by: "nv03",
                at: 1,
                text: "Path tự động chỉ dùng được cho đồ cứng (hộp, chai). Túi vải, đồ len vẫn phải pen tool tay.",
                replies: [
                  { by: "khoa", at: 1.3, text: "Ok, action chỉ dùng cho đồ cứng, đồ mềm làm tay. Ghi rõ vào hướng dẫn." }
                ]
              },
              {
                by: "nv09",
                at: 3,
                text: "Em thêm bước tạo lớp nền đen để soi viền, sót pixel thấy liền.",
                edited: "Em thêm bước tạo lớp nền đen + nền đỏ để soi viền, sót pixel trắng thấy liền."
              },
              { by: "lead1", at: 6, text: "Hạn 8/10 qua rồi, @{nv03} chốt bản action trước thứ 2 để kịp đơn thử khách Nhật nhé." }
            ]
          },
          {
            title: "Preset virtual staging: bóng đổ đồ nội thất mềm hơn",
            priority: "low",
            creator: "lead2",
            assignees: [],
            status: "Đề xuất",
            due: "none",
            createdDaysAgo: 13
          },
          {
            title: "Đo thời gian xử lý ảnh HDR: action v2 so với v3",
            desc: "Mỗi bạn làm 20 ảnh bằng v2 và 20 ảnh tương đương bằng v3 (5 bracket, có cửa sổ), ghi thời gian vào bảng chung.",
            priority: "normal",
            creator: "khoa",
            assignees: ["nv05", "nv06", "nv11"],
            status: "Đang thử nghiệm",
            due: "next_week",
            createdDaysAgo: 4
          },
          {
            title: "Thử plugin AI xoá vật thể thay cho clone stamp",
            priority: "low",
            creator: "lead2",
            assignees: ["lead2", "nv07"],
            status: "Không áp dụng",
            createdDaysAgo: 27,
            comments: [
              { by: "lead2", at: 4, text: "Thử 40 ảnh: nhanh gấp 3 nhưng 12 ảnh bị lặp texture sàn gỗ, QC trả hết." },
              {
                by: "khoa",
                at: 5,
                text: "Kết quả không ổn định, chưa áp dụng. Giữ clone stamp + healing như cũ.",
                replies: [{ by: "boss", at: 5.5, text: "Đồng ý. Cứ theo dõi, khi nào công cụ ổn hơn thì thử lại." }]
              }
            ]
          },
          {
            title: "Bàn giao action HDR blend v2 của Lộc trước khi nghỉ",
            priority: "normal",
            creator: "lead1",
            assignees: ["lead1"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 33,
            comments: [
              {
                by: "loc",
                at: 1,
                text: "Em để bản v2 và file ghi chú các bước ở `\\\\NAS-01\\Retouch\\Actions\\HDR-v2`, kèm video quay màn hình 8 phút.",
                replies: [{ by: "lead1", at: 1.2, text: "Cảm ơn em nhiều, mai anh chạy thử." }]
              }
            ]
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Style guide khách hàng",
        description: "Tổng hợp yêu cầu theo từng nhóm khách. Không ghi tên khách thật, chỉ dùng tên nhóm.",
        color: "amber",
        tasks: [
          {
            title: "Style guide khách BĐS Úc nhóm A: bầu trời, cửa sổ, cỏ",
            desc: L(
              "## Bầu trời",
              "- Xanh nhạt, mây trắng mỏng, không dùng trời xanh đậm",
              "- Ảnh mặt sau nhà: trời đồng bộ với mặt trước",
              "",
              "## Cửa sổ",
              "- Luôn thấy cảnh ngoài, sáng hơn trong phòng tối đa 1 stop",
              "",
              "## Cỏ",
              "- Xanh tự nhiên, vá chỗ cỏ cháy nếu diện tích dưới 20%",
              "",
              "> Nhóm A phàn nàn 2 lần trong đợt rush vì trời quá xanh."
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["khoa", "lead1", "nv07"],
            status: "Đang áp dụng",
            due: "none",
            createdDaysAgo: 30,
            comments: [
              {
                by: "nv07",
                at: 10,
                text: "Ảnh chụp chiều muộn thì vẫn dùng trời xanh nhạt hay chuyển trời chiều ạ?",
                replies: [{ by: "khoa", at: 10.3, text: "Nhóm A luôn dùng trời ban ngày, trừ khi đơn ghi day-to-dusk." }]
              },
              { by: "lead1", at: 27, text: "Cập nhật: nhóm A muốn cỏ bớt xanh, xem task cập nhật style guide mới nhé." }
            ]
          },
          {
            title: "Style guide khách BĐS Úc nhóm B (agency nhỏ, thích ảnh sáng)",
            desc: L(
              "- Ảnh sáng, thoáng, phơi sáng cao hơn nhóm A khoảng +0.3 EV",
              "- Trời xanh vừa, đồng bộ cả bộ ảnh cùng căn",
              "- Cửa sổ không cần kéo quá rõ, ưu tiên phòng sáng"
            ),
            priority: "normal",
            creator: "lead2",
            assignees: ["lead2", "nv08", "nv12"],
            status: "Đang áp dụng",
            due: "week",
            createdDaysAgo: 26
          },
          {
            title: "Style guide khách Nhật sản phẩm: nền trắng tuyệt đối, viền sạch",
            desc: L(
              "- Nền trắng RGB 255, kiểm bằng Info panel ở 4 góc và quanh sản phẩm",
              "- Viền không răng cưa, không viền trắng/xám, kiểm ở zoom 200%",
              "- Màu sản phẩm đúng mẫu thật, KHÔNG làm tươi màu",
              "- Bóng đổ chỉ giữ khi đơn ghi “natural shadow”",
              "- Xuất JPG chất lượng 12, sRGB, cạnh dài 3000px"
            ),
            priority: "urgent",
            creator: "khoa",
            assignees: ["khoa", "nv03", "nv13"],
            status: "Đang thử nghiệm",
            due: "tomorrow",
            createdDaysAgo: 6,
            subtasks: [
              { title: "Dịch file yêu cầu tiếng Nhật sang tiếng Việt", assignees: ["khoa"], status: "Hoàn tất" },
              { title: "Làm 10 ảnh mẫu đúng/sai", assignees: ["nv13"], status: "Đang thử nghiệm" }
            ],
            comments: [
              {
                by: "nv13",
                at: 1,
                text: "Sản phẩm bóng (chai thuỷ tinh) có phản chiếu nền cũ, có phải xoá phản chiếu không anh?",
                replies: [
                  { by: "khoa", at: 1.4, text: "Giữ phản chiếu nhưng đổi sang tông trắng xám trung tính, không để màu nền cũ." }
                ]
              },
              {
                by: "khoa",
                at: 3,
                text: "Ảnh mẫu viền đạt/không đạt ở zoom 200%, mọi người xem trước khi làm.",
                files: [{ name: "mau-vien-san-pham-200.png", hint: "so sánh viền sản phẩm cắt nền ở zoom 200%: đạt và không đạt" }]
              },
              { by: "linh", at: 5.5, text: "Account báo khách Nhật hỏi tiến độ đơn thử, chị trả lời 13/10 giao đủ nhé @{khoa}." }
            ]
          },
          {
            title: "Style guide agency Mỹ: virtual staging phong cách tối giản",
            priority: "normal",
            creator: "khoa",
            assignees: ["nv10", "nv14"],
            status: "Đề xuất",
            due: "next_week",
            createdDaysAgo: 10
          },
          {
            title: "Tổng hợp phản hồi khách về màu trời trong đợt rush tháng 9",
            priority: "normal",
            creator: "khoa",
            assignees: ["khoa", "lead1"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 21,
            comments: [
              {
                by: "khoa",
                at: 1,
                text: "Có 2 phản hồi: trời quá xanh (nhóm A) và trời không đồng bộ giữa các ảnh cùng căn (nhóm B).",
                replies: [
                  { by: "boss", at: 1.5, text: "Cả 2 lỗi đều tránh được nếu có thư viện trời chuẩn. Làm luôn nhé." },
                  { by: "lead1", at: 1.7, text: "Tuần này em lọc thư viện trời anh." }
                ]
              }
            ]
          },
          {
            title: "Mẫu ghi chú yêu cầu khách khi nhận đơn (cho bên account)",
            priority: "normal",
            creator: "linh",
            assignees: ["khoa"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 31
          },
          {
            title: "Bộ ảnh tham chiếu đúng/sai cho từng nhóm khách",
            priority: "normal",
            creator: "khoa",
            assignees: ["nv06", "nv15", "lead2"],
            status: "Đang thử nghiệm",
            due: "later",
            createdDaysAgo: 14
          },
          {
            title: "Cập nhật style guide nhóm A theo phản hồi mới: cỏ bớt xanh",
            priority: "normal",
            creator: "lead1",
            assignees: ["nv07", "nv01", "nv02"],
            status: "Đang thử nghiệm",
            due: "today",
            createdDaysAgo: 3,
            comments: [
              {
                by: "lead1",
                at: 0.2,
                text: "Nhóm A phản hồi cỏ xanh quá giả, giảm saturation kênh xanh lá khoảng 15%. @{nv07} làm 5 ảnh mẫu gửi anh duyệt.",
                replies: [
                  { by: "nv07", at: 2.8, text: "Em để 5 ảnh mẫu trong thư mục `StyleGuide\\NhomA\\Co` rồi anh ơi." }
                ]
              }
            ]
          },
          {
            title: "Thư viện bầu trời chuẩn dùng chung (60 ảnh trời)",
            priority: "normal",
            creator: "lead1",
            assignees: ["nv05", "lead1"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 19
          },
          {
            title: "Style guide khách lẻ (trùng với nhóm B)",
            priority: "low",
            creator: "lead2",
            assignees: [],
            status: "Đề xuất",
            due: "none",
            createdDaysAgo: 20,
            trash: true
          }
        ]
      },
      // ---------------------------------------------------------------------------------------------
      {
        name: "Đo lường năng suất",
        description: "Số liệu năng suất và chất lượng: thời gian trung bình/ảnh, tỷ lệ QC fail, báo cáo tuần.",
        color: "green",
        tasks: [
          {
            title: "Báo cáo năng suất tuần 40 (28/9 – 3/10)",
            priority: "normal",
            creator: "khoa",
            assignees: ["khoa", "lead1"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 7,
            files: [
              { name: "nang-suat-tuan-40.xlsx", hint: "báo cáo năng suất tuần 40: số ảnh theo ca, thời gian trung bình/ảnh, QC fail 5,2%" }
            ],
            comments: [
              {
                by: "khoa",
                at: 0.5,
                text: "Tuần 40: tổng 4.860 ảnh, QC fail 5,2% (đợt rush là 11,8%). HDR trung bình 6,4 phút/ảnh.",
                replies: [
                  { by: "boss", at: 1, text: "Đỡ hơn rồi. Tuần sau có checklist v2 xem xuống dưới 4% được không." },
                  { by: "lead1", at: 1.2, text: "Ca A đặt mục tiêu 3,5% anh ạ 💪" }
                ]
              }
            ]
          },
          {
            title: "Báo cáo năng suất tuần 41 (5/10 – 10/10)",
            priority: "normal",
            creator: "khoa",
            assignees: ["khoa", "lead2"],
            status: "Đang áp dụng",
            due: "tomorrow",
            createdDaysAgo: 1
          },
          {
            title: "Xem báo cáo năng suất Q3 và chốt KPI Q4",
            desc: L(
              "@{boss} số liệu Q3 em tổng hợp ở [báo cáo Q3](https://nesso.example/reports/nang-suat-q3).",
              "",
              "Đề xuất KPI Q4:",
              "- QC fail ≤ 4% mỗi tuần",
              "- HDR trung bình ≤ 6 phút/ảnh",
              "- Đơn rush trả đúng hạn ≥ 98%",
              "- Retoucher mới đạt 70% năng suất sau 4 tuần"
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["boss"],
            status: "Đề xuất",
            due: "week",
            createdDaysAgo: 8,
            subtasks: [
              { title: "Tổng hợp số liệu Q3 theo tháng", assignees: ["khoa"], status: "Hoàn tất" },
              { title: "Họp chốt KPI với 2 trưởng ca", assignees: ["lead1", "lead2"], status: "Đề xuất", due: "week" }
            ],
            comments: [
              {
                by: "boss",
                at: 2,
                text: "QC fail 4% ok. HDR để 6,2 phút cho thực tế, sắp có nhiều người mới.",
                replies: [{ by: "khoa", at: 2.3, text: "Dạ em sửa lại." }]
              },
              {
                by: "khoa",
                at: 7,
                text: "@{boss} em cập nhật KPI theo góp ý rồi, anh duyệt để thứ 2 công bố cho các ca ạ.",
                edited: "@{boss} em cập nhật KPI theo góp ý rồi (HDR 6,2 phút/ảnh), anh duyệt để thứ 2 công bố cho các ca ạ.",
                replies: [
                  { by: "linh", at: 7.4, text: "Chị đồng ý bản này, KPI người mới chị đưa vào kế hoạch đào tạo luôn." }
                ]
              }
            ]
          },
          {
            title: "Đo thời gian trung bình/ảnh theo loại dịch vụ (HDR, thay trời, staging)",
            desc: L(
              "Mỗi bạn ghi thời gian xử lý từng ảnh vào [bảng theo dõi](https://nesso.example/files/do-thoi-gian) trong 2 tuần:",
              "",
              "- HDR blend (3/5/7 bracket)",
              "- Thay trời",
              "- Virtual staging",
              "- Xoá vật thể",
              "",
              "Số liệu dùng để chia việc theo ca và tính KPI Q4."
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["nv01", "nv04", "nv12"],
            status: "Đang áp dụng",
            due: "none",
            createdDaysAgo: 24,
            subtasks: [
              { title: "Tạo bảng theo dõi chung", assignees: ["nv12"], status: "Hoàn tất" },
              { title: "Tổng hợp số liệu tuần 39–40", assignees: ["nv01"], status: "Đang áp dụng" }
            ]
          },
          {
            title: "Tỷ lệ QC fail theo nhóm và theo ca, tuần 38 đến 41",
            priority: "urgent",
            creator: "boss",
            assignees: ["khoa", "nv10"],
            status: "Đang thử nghiệm",
            due: "overdue",
            createdDaysAgo: 13,
            comments: [
              {
                by: "boss",
                at: 0.05,
                text: "Anh cần QC fail tách theo nhóm A/B và ca sáng/chiều/đêm, để biết chỗ nào cần kèm thêm."
              },
              {
                by: "khoa",
                at: 3,
                text: "Tuần 38–39 đủ số liệu, tuần 40 thiếu ca đêm do chưa ghi lỗi trên Nesso Work.",
                replies: [{ by: "lead2", at: 3.5, text: "Ca đêm em bổ sung lại từ file Excel, chậm 1–2 ngày anh nhé." }]
              },
              {
                by: "boss",
                at: 12.6,
                text: "Hạn qua rồi đó @{khoa}, thứ 2 anh cần số này để họp Q4.",
                replies: [{ by: "khoa", at: 12.8, text: "Dạ em gửi anh trước 9h sáng thứ 2 ạ." }]
              }
            ]
          },
          {
            title: "Bấm giờ xử lý ảnh trên Nesso Work (thử 2 tuần)",
            priority: "normal",
            creator: "khoa",
            assignees: ["nv02", "nv06", "nv13"],
            status: "Đang thử nghiệm",
            due: "next_week",
            createdDaysAgo: 9,
            comments: [
              {
                by: "nv02",
                at: 2,
                text: "Bấm giờ trên điện thoại hơi bất tiện khi đang làm trên máy, có bản trên máy tính không ạ?",
                replies: [{ by: "khoa", at: 2.4, text: "Dùng bản web trên máy luôn em, ghim tab cạnh Photoshop là được." }]
              }
            ]
          },
          {
            title: "Đo năng suất ca đêm trong đợt rush 14–19/9",
            priority: "normal",
            creator: "lead2",
            assignees: ["lead2", "lead1"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 20
          },
          {
            title: "Bảng tổng hợp năng suất tự động từ file chấm công",
            priority: "low",
            creator: "khoa",
            assignees: ["khoa"],
            status: "Không áp dụng",
            createdDaysAgo: 22
          },
          {
            title: "Đo thời gian cắt nền sản phẩm cho đơn thử khách Nhật (100 ảnh)",
            desc: L(
              "Ghi thời gian từng ảnh của đơn thử, chia 3 nhóm:",
              "",
              "- Đồ cứng (hộp, chai): dùng action",
              "- Đồ mềm (túi vải, đồ len): pen tool tay",
              "- Đồ có lỗ hở, quai mảnh",
              "",
              "Cần số liệu để account báo thời gian trả ảnh cho khách Nhật."
            ),
            priority: "high",
            creator: "khoa",
            assignees: ["nv03", "nv09", "nv14"],
            status: "Đang thử nghiệm",
            due: "week",
            createdDaysAgo: 5
          },
          {
            title: "Khảo sát retoucher: khâu nào mất thời gian nhất?",
            priority: "low",
            creator: "khoa",
            assignees: ["khoa"],
            status: "Hoàn tất",
            due: "past",
            createdDaysAgo: 36,
            comments: [
              {
                by: "khoa",
                at: 3,
                text: "14/15 bạn đã trả lời: mất thời gian nhất là mask cửa sổ (9 phiếu) và xoá vật thể (4 phiếu).",
                replies: [{ by: "lead1", at: 3.3, text: "Vậy ưu tiên làm action mask cửa sổ trước nhé." }]
              }
            ]
          }
        ]
      }
    ]
  }
];
