/**
 * Invented knowledge-base content for the LOCAL demo (seed-knowledge.ts): an imaginary photo-retouch company.
 * Nothing here is real company data, and nothing holds a password or account number (PD-031).
 *
 * People are roles, resolved to real dev accounts by the engine: owner = the superadmin; lead1 / lead2 = team leads;
 * staff1…staff6 = members.
 */

export type Person = "owner" | "lead1" | "lead2" | "staff1" | "staff2" | "staff3" | "staff4" | "staff5" | "staff6";
export type Inline = string | { mention: Person } | { bold: string };
export type Para = string | Inline[];
export type Block = { h: string } | { p: Para } | { ul: Para[] } | { ol: Para[] } | { note: Para };
export type StatusName = "Nháp" | "Chờ duyệt" | "Đã ban hành" | "Cần cập nhật" | "Hết hiệu lực";
export type Importance = "normal" | "important" | "critical";

export type CommentSeed = {
  day: string;
  by: Person;
  text: Para;
  replies?: { day: string; by: Person; text: Para }[];
  resolvedBy?: Person;
};

export type ItemSeed = {
  title: string;
  summary?: string;
  /** "Quy trình/Retouch" (top / sub category) or "Biểu mẫu". */
  category?: string;
  importance: Importance;
  author: Person;
  owner?: Person;
  tags: string[];
  pinned?: boolean;
  effectiveFrom?: string;
  reviewBy?: string;
  /** Business day the item was written. */
  day: string;
  body: Block[];
  status: StatusName;
  /** Who publishes (approval spaces) and when. */
  publishedBy?: Person;
  publishDay?: string;
  revisions?: { day: string; by: Person; note: string; reason?: string; body?: Block[] }[];
  /** For "Cần cập nhật" / "Hết hiệu lực": who changed the status, when, why. */
  finalStatusBy?: Person;
  finalStatusDay?: string;
  finalStatusReason?: string;
  comments?: CommentSeed[];
  /** Moved to the space trash afterwards (kept 30 days). */
  trashedBy?: Person;
  trashedDay?: string;
  trashedReason?: string;
};

export type SpaceSeed = {
  name: string;
  description: string;
  visibility: "public" | "private";
  color: string;
  icon: string;
  approvalRequired: boolean;
  day: string;
  members: { who: Person; level: "view" | "submit" | "manage" }[];
  categories: { name: string; children?: string[] }[];
  items: ItemSeed[];
};

const retouchPortraitV1: Block[] = [
  { h: "Phạm vi" },
  { p: "Áp dụng cho mọi job ảnh chân dung studio và ngoại cảnh, từ khi nhận file gốc đến khi giao bản hoàn thiện." },
  { h: "Các bước" },
  {
    ol: [
      "Kiểm tra file gốc: đủ số lượng, đúng định dạng RAW / JPG theo phiếu job.",
      "Cân sáng và cân màu tổng thể theo profile của khách.",
      "Làm da: giữ texture, chỉ xử lý mụn, vết thâm và nếp nhăn tạm thời.",
      "Chỉnh dáng nhẹ (nếu phiếu job yêu cầu), không thay đổi khuôn mặt.",
      "Xuất file theo quy định đặt tên và cấu trúc thư mục giao hàng."
    ]
  },
  { note: [{ bold: "Lưu ý: " }, "Không dùng plugin làm mịn da tự động ở mức trên 30%. Ảnh bị bệt da sẽ bị QC trả lại."] }
];

const retouchPortraitV2: Block[] = [
  ...retouchPortraitV1.slice(0, 3),
  {
    ol: [
      "Kiểm tra file gốc: đủ số lượng, đúng định dạng RAW / JPG theo phiếu job.",
      "Cân sáng và cân màu tổng thể theo profile của khách (xem bài “Hướng dẫn cân màu theo profile khách hàng”).",
      "Làm da: giữ texture, chỉ xử lý mụn, vết thâm và nếp nhăn tạm thời.",
      "Làm mắt và răng: tăng độ trong vừa phải, không làm trắng răng quá tông da.",
      "Chỉnh dáng nhẹ (nếu phiếu job yêu cầu), không thay đổi khuôn mặt.",
      "Tự kiểm tra bằng checklist QC trước khi chuyển trạng thái chờ QC.",
      "Xuất file theo quy định đặt tên và cấu trúc thư mục giao hàng."
    ]
  },
  { note: [{ bold: "Lưu ý: " }, "Không dùng plugin làm mịn da tự động ở mức trên 30%. Ảnh bị bệt da sẽ bị QC trả lại."] },
  { h: "Thời gian chuẩn" },
  { ul: ["Chân dung studio: 6–8 phút / ảnh.", "Chân dung ngoại cảnh: 8–12 phút / ảnh.", "Ảnh nhóm từ 5 người: tính theo bảng quy đổi điểm."] }
];

const leavePolicyV1: Block[] = [
  { h: "Số ngày phép" },
  {
    ul: [
      "Nhân viên chính thức: 12 ngày phép năm, cộng 1 ngày cho mỗi 5 năm làm việc.",
      "Nhân viên thử việc: chưa có phép năm, được nghỉ không lương khi có lý do chính đáng.",
      "Phép năm chưa dùng được chuyển sang quý I năm sau, tối đa 5 ngày."
    ]
  },
  { h: "Cách đăng ký" },
  {
    ol: [
      "Đăng ký trên Nesso Work (Sản xuất › Nghỉ phép) ít nhất 3 ngày làm việc trước ngày nghỉ.",
      "Trưởng nhóm duyệt trong 1 ngày làm việc.",
      "Nghỉ đột xuất (ốm, việc gia đình): báo trưởng nhóm trước 8:00 sáng và bổ sung đơn trong ngày."
    ]
  },
  { note: [{ bold: "Lưu ý: " }, "Mùa cao điểm (tháng 11 – tháng 1) mỗi nhóm có tối đa 2 người nghỉ cùng ngày."] }
];

const leavePolicyV2: Block[] = [
  ...leavePolicyV1.slice(0, 4),
  {
    ol: [
      "Đăng ký trên Nesso Work (Sản xuất › Nghỉ phép) ít nhất 3 ngày làm việc trước ngày nghỉ; nghỉ từ 3 ngày liên tiếp: trước 7 ngày.",
      "Trưởng nhóm duyệt trong 1 ngày làm việc.",
      "Nghỉ đột xuất (ốm, việc gia đình): báo trưởng nhóm trước 8:00 sáng và bổ sung đơn trong ngày."
    ]
  },
  { note: [{ bold: "Lưu ý: " }, "Mùa cao điểm (tháng 11 – tháng 1) mỗi nhóm có tối đa 2 người nghỉ cùng ngày."] },
  { h: "Nghỉ phép đặc biệt" },
  { ul: ["Kết hôn: 3 ngày có lương.", "Con kết hôn: 1 ngày có lương.", "Tứ thân phụ mẫu, vợ / chồng, con mất: 3 ngày có lương."] }
];

export const spaces: SpaceSeed[] = [
  {
    name: "Quy trình Sản xuất",
    description: "Quy trình chuẩn, checklist và biểu mẫu của bộ phận sản xuất (retouch, QC, giao hàng).",
    visibility: "public",
    color: "blue",
    icon: "workflow",
    approvalRequired: true,
    day: "2026-08-24",
    members: [
      { who: "lead1", level: "manage" },
      { who: "lead2", level: "submit" },
      { who: "staff1", level: "submit" },
      { who: "staff2", level: "submit" },
      { who: "staff3", level: "view" },
      { who: "staff4", level: "view" }
    ],
    categories: [{ name: "Quy trình", children: ["Retouch", "QC"] }, { name: "Khách hàng" }, { name: "Biểu mẫu" }],
    items: [
      {
        title: "Quy trình retouch ảnh chân dung",
        summary: "Các bước chuẩn khi retouch chân dung studio và ngoại cảnh, thời gian chuẩn cho mỗi ảnh.",
        category: "Quy trình/Retouch",
        importance: "critical",
        author: "lead1",
        owner: "lead1",
        tags: ["retouch", "chân dung", "quy trình"],
        pinned: true,
        effectiveFrom: "2026-09-01",
        reviewBy: "2027-03-01",
        day: "2026-08-26",
        body: retouchPortraitV1,
        status: "Đã ban hành",
        publishedBy: "owner",
        publishDay: "2026-08-28",
        revisions: [
          {
            day: "2026-09-15",
            by: "lead1",
            note: "Thêm bước làm mắt, răng và tự kiểm tra QC",
            reason: "QC trả lại nhiều ảnh thiếu bước làm mắt",
            body: retouchPortraitV2
          }
        ],
        comments: [
          {
            day: "2026-09-10",
            by: "staff3",
            text: ["Bước 3 nên ghi rõ mức làm mịn tối đa cho ảnh ngoại cảnh không ạ? ", { mention: "lead1" }],
            replies: [{ day: "2026-09-10", by: "lead1", text: "Đã bổ sung trong phiên bản tới, cảm ơn em." }],
            resolvedBy: "lead1"
          },
          {
            day: "2026-10-06",
            by: "staff4",
            text: ["Thời gian chuẩn cho ảnh nhóm có cần tách riêng không ạ? ", { mention: "staff1" }, " đang làm job ảnh kỷ yếu thấy hơi gấp."]
          }
        ]
      },
      {
        title: "Quy trình retouch ảnh sản phẩm thương mại điện tử",
        summary: "Tách nền, cân màu đúng sản phẩm thật, kích thước xuất cho các sàn thương mại điện tử.",
        category: "Quy trình/Retouch",
        importance: "important",
        author: "staff1",
        owner: "lead2",
        tags: ["retouch", "sản phẩm", "tách nền"],
        effectiveFrom: "2026-09-05",
        reviewBy: "2027-01-15",
        day: "2026-08-31",
        body: [
          { h: "Đầu vào" },
          { p: "Ảnh chụp sản phẩm trên nền trắng hoặc xám, kèm ảnh tham chiếu màu thật của khách (nếu có)." },
          { h: "Các bước" },
          {
            ol: [
              "Tách nền bằng pen tool, đường cắt sát, không răng cưa.",
              "Cân màu theo ảnh tham chiếu; chụp màn hình so sánh gửi kèm nếu khác biệt rõ.",
              "Xoá bụi, vết xước, nhãn mác không mong muốn.",
              "Tạo bóng đổ tự nhiên theo yêu cầu của khách.",
              "Xuất 2000 × 2000 px, nền trắng tuyệt đối (#FFFFFF), JPG chất lượng 90."
            ]
          }
        ],
        status: "Đã ban hành",
        publishedBy: "lead1",
        publishDay: "2026-09-02",
        comments: [{ day: "2026-09-20", by: "staff2", text: "Khách mỹ phẩm yêu cầu xuất thêm PNG nền trong suốt, mình có thêm vào quy trình không ạ?" }]
      },
      {
        title: "Checklist QC trước khi giao ảnh",
        summary: "12 điểm QC bắt buộc kiểm tra trước khi chuyển job sang trạng thái giao khách.",
        category: "Quy trình/QC",
        importance: "critical",
        author: "lead2",
        owner: "lead2",
        tags: ["qc", "checklist", "giao hàng"],
        pinned: true,
        effectiveFrom: "2026-09-01",
        reviewBy: "2026-10-08",
        day: "2026-08-27",
        body: [
          { h: "Kỹ thuật" },
          { ul: ["Đúng kích thước, định dạng, hệ màu theo phiếu job.", "Không còn layer ẩn, không lộ vết clone / heal.", "Da giữ texture, không bệt."] },
          { h: "Nội dung" },
          { ul: ["Đủ số lượng ảnh, đúng thứ tự tên file.", "Đã xử lý đủ các ghi chú của khách.", "Ảnh feedback lần trước đã sửa đúng yêu cầu."] },
          { note: [{ bold: "Lưu ý: " }, "Ảnh không đạt ≥ 2 điểm: trả lại người làm, ghi rõ điểm sai trên task."] }
        ],
        status: "Đã ban hành",
        publishedBy: "lead1",
        publishDay: "2026-08-29",
        comments: [
          {
            day: "2026-10-09",
            by: "lead1",
            text: [{ mention: "lead2" }, " checklist tới hạn rà soát rồi, em xem bổ sung mục kiểm tra profile màu giúp anh."]
          }
        ]
      },
      {
        title: "Hướng dẫn cân màu theo profile khách hàng",
        summary: "Cách dùng profile màu đã lưu của từng khách và xử lý khi khách đổi máy ảnh.",
        category: "Quy trình/Retouch",
        importance: "important",
        author: "staff2",
        owner: "staff2",
        tags: ["màu sắc", "profile"],
        day: "2026-09-04",
        reviewBy: "2026-12-31",
        body: [
          { p: "Mỗi khách có một profile màu lưu trong thư mục chung (Khách hàng › Profile màu). Luôn áp profile trước khi chỉnh tay." },
          { ol: ["Mở ảnh mẫu đã được khách duyệt.", "Áp profile tương ứng, so sánh hai ảnh cạnh nhau.", "Chỉnh tay phần chênh lệch còn lại."] }
        ],
        status: "Cần cập nhật",
        publishedBy: "lead1",
        publishDay: "2026-09-06",
        finalStatusBy: "lead1",
        finalStatusDay: "2026-10-02",
        finalStatusReason: "Khách lớn đổi sang máy ảnh mới, profile cũ không còn đúng",
        comments: [{ day: "2026-10-02", by: "lead1", text: [{ mention: "staff2" }, " em cập nhật phần đổi máy ảnh nhé, khách Ánh Dương vừa đổi body máy."] }]
      },
      {
        title: "Quy trình xử lý feedback khách hàng",
        summary: "Nhận, phân loại và xử lý feedback; khi nào tính là lỗi của người làm.",
        category: "Khách hàng",
        importance: "important",
        author: "lead1",
        owner: "lead1",
        tags: ["feedback", "khách hàng"],
        effectiveFrom: "2026-09-10",
        reviewBy: "2027-03-10",
        day: "2026-09-08",
        body: [
          { h: "Phân loại" },
          { ul: ["Sai so với yêu cầu ban đầu: lỗi sản xuất, sửa miễn phí.", "Yêu cầu thêm ngoài phiếu job: báo giá bổ sung trước khi làm."] },
          { h: "Thời hạn xử lý" },
          { p: "Feedback nhận trước 15:00 xử lý trong ngày; sau 15:00 xử lý trước 10:00 sáng hôm sau." }
        ],
        status: "Đã ban hành",
        publishedBy: "owner",
        publishDay: "2026-09-09"
      },
      {
        title: "Bảng quy đổi điểm theo loại ảnh",
        summary: "Hệ số điểm cho từng loại ảnh dùng khi chia task và tính KPI.",
        category: "Biểu mẫu",
        importance: "normal",
        author: "lead1",
        tags: ["kpi", "điểm"],
        pinned: true,
        day: "2026-08-25",
        body: [
          { ul: ["Chân dung đơn: 1,0 điểm.", "Chân dung nhóm 2–4 người: 1,5 điểm.", "Ảnh nhóm từ 5 người: 2,0 điểm.", "Sản phẩm tách nền: 0,8 điểm.", "Ảnh cưới chọn lọc: 1,2 điểm."] }
        ],
        status: "Đã ban hành",
        publishedBy: "lead1",
        publishDay: "2026-08-25"
      },
      {
        title: "Quy trình nhận job mới và chia task",
        summary: "Từ lúc Account tạo job đến khi trưởng nhóm chia task cho từng người.",
        category: "Quy trình",
        importance: "normal",
        author: "lead2",
        owner: "lead2",
        tags: ["job", "chia task"],
        day: "2026-09-12",
        body: [
          { ol: ["Account tạo job, đính kèm phiếu yêu cầu.", "Trưởng nhóm kiểm tra phiếu trong 30 phút.", "Chia task theo năng lực và khối lượng hiện tại.", "Đặt deadline nội bộ sớm hơn deadline khách ít nhất 2 giờ."] }
        ],
        status: "Đã ban hành",
        publishedBy: "lead1",
        publishDay: "2026-09-14"
      },
      {
        title: "Quy định đặt tên file và cấu trúc thư mục giao hàng",
        summary: "Mẫu tên file và thư mục giao để khách và QC tra cứu nhanh.",
        category: "Biểu mẫu",
        importance: "normal",
        author: "staff1",
        tags: ["giao hàng", "đặt tên"],
        pinned: true,
        day: "2026-09-03",
        body: [
          { p: [{ bold: "Tên file: " }, "<Mã job>_<số thứ tự 3 chữ số>_<phiên bản>.jpg, ví dụ JOB0412_007_v2.jpg."] },
          { p: [{ bold: "Thư mục: " }, "<Mã job> / 01_Goc, 02_Hoan_thien, 03_Feedback."] }
        ],
        status: "Đã ban hành",
        publishedBy: "lead1",
        publishDay: "2026-09-04"
      },
      {
        title: "Quy trình retouch ảnh cưới",
        summary: "Quy trình riêng cho album cưới: chọn ảnh, tông màu chủ đạo, retouch chi tiết ảnh chính.",
        category: "Quy trình/Retouch",
        importance: "important",
        author: "staff2",
        owner: "lead2",
        tags: ["retouch", "ảnh cưới"],
        day: "2026-10-07",
        body: [
          { h: "Chọn ảnh" },
          { p: "Khách chọn tối đa 60 ảnh chính để retouch chi tiết; các ảnh còn lại chỉ cân màu theo tông chung." },
          { h: "Tông màu" },
          { p: "Thống nhất 1 preset tông màu cho cả album, gửi khách duyệt 5 ảnh mẫu trước khi làm hàng loạt." }
        ],
        status: "Chờ duyệt",
        comments: [{ day: "2026-10-08", by: "lead2", text: [{ mention: "owner" }, " anh xem duyệt giúp em quy trình này trước mùa cưới nhé."] }]
      },
      {
        title: "Quy trình giao ảnh qua FTP (cũ)",
        summary: "Không còn áp dụng: từ tháng 9/2026 giao ảnh qua link ổ đĩa chung.",
        category: "Quy trình",
        importance: "normal",
        author: "lead1",
        tags: ["giao hàng"],
        day: "2026-08-24",
        body: [{ p: "Tải ảnh lên máy chủ FTP của công ty, gửi khách thông tin đăng nhập qua Account." }],
        status: "Hết hiệu lực",
        publishedBy: "lead1",
        publishDay: "2026-08-24",
        finalStatusBy: "lead1",
        finalStatusDay: "2026-09-01",
        finalStatusReason: "Đã chuyển sang giao qua ổ đĩa chung"
      },
      {
        title: "Quy trình xử lý ảnh RAW số lượng lớn",
        summary: "Đang soạn: batch xử lý cho job trên 500 ảnh.",
        category: "Quy trình/Retouch",
        importance: "normal",
        author: "staff1",
        tags: ["raw", "batch"],
        day: "2026-10-09",
        body: [{ p: "Ghi chú ban đầu: dùng Lightroom đồng bộ cân màu theo từng cụm ánh sáng, sau đó mới xuất sang Photoshop." }],
        status: "Nháp"
      },
      {
        title: "Ghi chú tạm: thử preset màu mùa thu",
        category: "Quy trình/Retouch",
        importance: "normal",
        author: "staff2",
        tags: ["màu sắc"],
        day: "2026-09-20",
        body: [{ p: "Preset thử cho bộ ảnh ngoại cảnh mùa thu, chưa dùng chính thức." }],
        status: "Nháp",
        trashedBy: "staff2",
        trashedDay: "2026-10-05",
        trashedReason: "Đã gộp vào hướng dẫn cân màu"
      }
    ]
  },
  {
    name: "Chính sách nhân sự",
    description: "Chính sách, nội quy và quy định nhân sự đang áp dụng cho toàn công ty.",
    visibility: "public",
    color: "emerald",
    icon: "users",
    approvalRequired: true,
    day: "2026-08-20",
    members: [
      { who: "lead1", level: "submit" },
      { who: "staff5", level: "submit" },
      { who: "lead2", level: "view" }
    ],
    categories: [{ name: "Chính sách", children: ["Nghỉ phép", "Lương thưởng"] }, { name: "Nội quy" }],
    items: [
      {
        title: "Chính sách nghỉ phép năm 2026",
        summary: "Số ngày phép, cách đăng ký, nghỉ đột xuất và nghỉ phép đặc biệt.",
        category: "Chính sách/Nghỉ phép",
        importance: "critical",
        author: "staff5",
        owner: "staff5",
        tags: ["nghỉ phép", "chính sách"],
        pinned: true,
        effectiveFrom: "2026-01-01",
        reviewBy: "2026-12-15",
        day: "2026-08-21",
        body: leavePolicyV1,
        status: "Đã ban hành",
        publishedBy: "owner",
        publishDay: "2026-08-22",
        revisions: [
          {
            day: "2026-09-18",
            // Approval on: published items are changed by managers only (PD-031 addendum).
            by: "owner",
            note: "Bổ sung nghỉ phép đặc biệt, quy định nghỉ dài ngày",
            reason: "Theo kết luận họp giao ban tháng 9",
            body: leavePolicyV2
          }
        ],
        comments: [
          {
            day: "2026-09-19",
            by: "staff3",
            text: "Phép năm chuyển sang quý I có cần đăng ký lại không ạ?",
            replies: [{ day: "2026-09-19", by: "staff5", text: "Không cần em nhé, hệ thống tự cộng vào số phép còn lại." }],
            resolvedBy: "staff5"
          }
        ]
      },
      {
        title: "Quy định đăng ký nghỉ phép trên hệ thống",
        summary: "Thao tác đăng ký, sửa, huỷ đơn nghỉ phép trên Nesso Work.",
        category: "Chính sách/Nghỉ phép",
        importance: "important",
        author: "staff5",
        tags: ["nghỉ phép", "nesso work"],
        day: "2026-08-23",
        body: [{ ol: ["Vào Sản xuất › Nghỉ phép, bấm “Xin nghỉ”.", "Chọn ngày, buổi và ghi lý do ngắn gọn.", "Theo dõi trạng thái đơn; được duyệt sẽ có thông báo."] }],
        status: "Đã ban hành",
        publishedBy: "owner",
        publishDay: "2026-08-24"
      },
      {
        title: "Chính sách thưởng KPI theo quý",
        summary: "Cách tính thưởng theo % KPI đạt được và thời điểm chi trả.",
        category: "Chính sách/Lương thưởng",
        importance: "critical",
        author: "lead1",
        owner: "owner",
        tags: ["kpi", "thưởng"],
        effectiveFrom: "2026-07-01",
        reviewBy: "2027-01-05",
        day: "2026-08-26",
        body: [
          { ul: ["Đạt dưới 80% KPI: không có thưởng quý.", "Đạt 80–100%: thưởng theo tỷ lệ đạt.", "Vượt 100%: thưởng thêm theo hệ số vượt, tối đa 150%."] },
          { p: "Thưởng chi cùng kỳ lương tháng đầu quý sau, sau khi chốt KPI." }
        ],
        status: "Đã ban hành",
        publishedBy: "owner",
        publishDay: "2026-08-28",
        comments: [{ day: "2026-09-02", by: "staff4", text: ["Hệ số vượt tính theo điểm hay theo số ảnh ạ? ", { mention: "lead1" }] }]
      },
      {
        title: "Nội quy giờ làm việc và ca trực",
        summary: "Giờ làm việc, ca trực cuối tuần mùa cao điểm và quy định đi muộn.",
        category: "Nội quy",
        importance: "important",
        author: "staff5",
        tags: ["giờ làm việc", "ca trực"],
        day: "2026-08-21",
        body: [
          { ul: ["Ca sáng: 8:00 – 12:00; ca chiều: 13:30 – 17:30.", "Mùa cao điểm: trực thứ Bảy luân phiên theo lịch nhóm."] },
          { note: [{ bold: "Lưu ý: " }, "Đi muộn quá 15 phút 3 lần trong tháng sẽ được trưởng nhóm nhắc nhở trực tiếp."] }
        ],
        status: "Đã ban hành",
        publishedBy: "owner",
        publishDay: "2026-08-22"
      },
      {
        title: "Quy định trang phục và ứng xử tại văn phòng",
        category: "Nội quy",
        importance: "normal",
        author: "staff5",
        tags: ["nội quy"],
        day: "2026-08-25",
        body: [{ ul: ["Trang phục gọn gàng, lịch sự khi gặp khách.", "Giữ yên lặng khu vực retouch, dùng tai nghe khi nghe nhạc.", "Không ăn uống tại bàn làm việc có máy tính đồ hoạ."] }],
        status: "Đã ban hành",
        publishedBy: "owner",
        publishDay: "2026-08-26"
      },
      {
        title: "Chính sách làm việc từ xa",
        summary: "Điều kiện, cách đăng ký và yêu cầu kết nối khi làm việc tại nhà.",
        category: "Chính sách",
        importance: "important",
        author: "lead1",
        tags: ["làm việc từ xa"],
        day: "2026-09-01",
        body: [{ p: "Nhân viên chính thức được làm việc từ xa tối đa 4 ngày / tháng, đăng ký trước với trưởng nhóm." }],
        status: "Cần cập nhật",
        publishedBy: "owner",
        publishDay: "2026-09-03",
        finalStatusBy: "owner",
        finalStatusDay: "2026-10-05",
        finalStatusReason: "Cần bổ sung yêu cầu VPN theo hướng dẫn IT mới"
      },
      {
        title: "Chính sách nghỉ phép năm 2025",
        summary: "Đã thay bằng chính sách nghỉ phép năm 2026.",
        category: "Chính sách/Nghỉ phép",
        importance: "important",
        author: "staff5",
        tags: ["nghỉ phép"],
        day: "2026-08-20",
        body: [{ p: "Nhân viên chính thức: 12 ngày phép năm; phép chưa dùng không được chuyển sang năm sau." }],
        status: "Hết hiệu lực",
        publishedBy: "owner",
        publishDay: "2026-08-20",
        finalStatusBy: "owner",
        finalStatusDay: "2026-08-22",
        finalStatusReason: "Thay bằng chính sách năm 2026"
      },
      {
        title: "Dự thảo: Chính sách đào tạo nội bộ",
        summary: "Đang soạn: lộ trình đào tạo retoucher mới trong 2 tháng đầu.",
        category: "Chính sách",
        importance: "normal",
        author: "staff5",
        tags: ["đào tạo"],
        day: "2026-10-06",
        body: [{ ul: ["Tuần 1–2: làm quen quy trình, ảnh sản phẩm.", "Tuần 3–6: chân dung có kèm cặp.", "Tuần 7–8: làm job thật, QC 100%."] }],
        status: "Nháp"
      }
    ]
  },
  {
    name: "Ban điều hành",
    description: "Kế hoạch, biên bản họp và thông tin nội bộ của ban điều hành. Chỉ thành viên được mời mới xem được.",
    visibility: "private",
    color: "violet",
    icon: "shield",
    approvalRequired: false,
    day: "2026-08-22",
    members: [
      { who: "lead1", level: "submit" },
      { who: "lead2", level: "view" }
    ],
    categories: [{ name: "Kế hoạch" }, { name: "Biên bản họp" }],
    items: [
      {
        title: "Kế hoạch kinh doanh quý IV/2026",
        summary: "Mục tiêu sản lượng, khách hàng trọng tâm và kế hoạch nhân sự mùa cao điểm.",
        category: "Kế hoạch",
        importance: "critical",
        author: "owner",
        owner: "owner",
        tags: ["kế hoạch", "quý IV"],
        effectiveFrom: "2026-10-01",
        reviewBy: "2026-11-15",
        day: "2026-09-25",
        body: [
          { h: "Mục tiêu" },
          { ul: ["Sản lượng: tăng 20% so với quý III.", "Giữ tỷ lệ feedback lỗi dưới 3%.", "Thêm 2 khách hàng thương mại điện tử lớn."] },
          { h: "Nhân sự" },
          { p: "Tuyển thêm 3 retoucher thời vụ từ tháng 11, đào tạo theo lộ trình nội bộ." }
        ],
        status: "Đã ban hành",
        revisions: [
          {
            day: "2026-10-03",
            by: "owner",
            note: "Điều chỉnh mục tiêu sản lượng sau họp giao ban",
            reason: "Số liệu quý III chốt lại thấp hơn dự kiến",
            body: [
              { h: "Mục tiêu" },
              { ul: ["Sản lượng: tăng 15% so với quý III.", "Giữ tỷ lệ feedback lỗi dưới 3%.", "Thêm 2 khách hàng thương mại điện tử lớn."] },
              { h: "Nhân sự" },
              { p: "Tuyển thêm 3 retoucher thời vụ từ tháng 11, đào tạo theo lộ trình nội bộ." }
            ]
          }
        ],
        comments: [{ day: "2026-10-04", by: "lead1", text: [{ mention: "owner" }, " em đề xuất ưu tiên tuyển người có kinh nghiệm ảnh cưới."] }]
      },
      {
        title: "Biên bản họp giao ban tháng 9",
        category: "Biên bản họp",
        importance: "important",
        author: "lead1",
        tags: ["biên bản", "giao ban"],
        day: "2026-09-30",
        body: [
          { h: "Kết luận" },
          { ol: ["Bổ sung nghỉ phép đặc biệt vào chính sách nghỉ phép.", "Rà soát lại checklist QC trước 10/10.", "Chuẩn bị quy trình ảnh cưới trước mùa cưới."] }
        ],
        status: "Đã ban hành"
      },
      {
        title: "Biên bản họp giao ban tháng 8",
        category: "Biên bản họp",
        importance: "normal",
        author: "lead1",
        tags: ["biên bản", "giao ban"],
        day: "2026-08-31",
        body: [{ ol: ["Chuyển giao ảnh từ FTP sang ổ đĩa chung từ 1/9.", "Áp dụng bảng quy đổi điểm mới."] }],
        status: "Đã ban hành"
      },
      {
        title: "Bảng giá dịch vụ cho khách hàng lớn",
        summary: "Đơn giá chiết khấu theo sản lượng tháng (thông tin nội bộ).",
        category: "Kế hoạch",
        importance: "critical",
        author: "owner",
        owner: "owner",
        tags: ["bảng giá", "khách hàng"],
        day: "2026-09-05",
        body: [{ ul: ["Trên 2.000 ảnh / tháng: chiết khấu 10%.", "Trên 5.000 ảnh / tháng: chiết khấu 15%.", "Hợp đồng năm: thêm 5%."] }],
        status: "Đã ban hành"
      },
      {
        title: "Định hướng tuyển dụng 2027",
        importance: "important",
        author: "owner",
        tags: ["tuyển dụng"],
        day: "2026-10-08",
        body: [{ p: "Đang soạn: nhu cầu nhân sự theo từng nhóm, ngân sách đào tạo." }],
        status: "Nháp"
      }
    ]
  },
  {
    name: "Hướng dẫn IT",
    description: "Hướng dẫn sử dụng phần mềm, thiết bị và quy định an toàn dữ liệu. Không lưu mật khẩu ở đây.",
    visibility: "public",
    color: "sky",
    icon: "code",
    approvalRequired: false,
    day: "2026-08-21",
    members: [
      { who: "staff6", level: "manage" },
      { who: "lead2", level: "submit" }
    ],
    categories: [{ name: "Tài khoản & bảo mật" }, { name: "Phần mềm", children: ["Photoshop", "Nesso Work"] }, { name: "Thiết bị" }],
    items: [
      {
        title: "Hướng dẫn đổi mật khẩu và bật xác thực hai lớp",
        summary: "Đổi mật khẩu định kỳ, bật xác thực hai lớp cho e-mail công ty. Không gửi mật khẩu qua chat.",
        category: "Tài khoản & bảo mật",
        importance: "critical",
        author: "staff6",
        owner: "staff6",
        tags: ["bảo mật", "mật khẩu", "2fa"],
        pinned: true,
        reviewBy: "2027-02-01",
        day: "2026-08-22",
        body: [
          { ol: ["Đổi mật khẩu 6 tháng một lần, tối thiểu 12 ký tự.", "Bật xác thực hai lớp bằng ứng dụng trên điện thoại.", "Không dùng chung mật khẩu với tài khoản cá nhân."] },
          { note: [{ bold: "Lưu ý: " }, "IT không bao giờ hỏi mật khẩu của bạn. Không gửi mật khẩu qua chat hay e-mail."] }
        ],
        status: "Đã ban hành",
        comments: [{ day: "2026-09-08", by: "staff2", text: ["Điện thoại em mất thì lấy lại xác thực hai lớp thế nào ạ? ", { mention: "staff6" }] }]
      },
      {
        title: "Cài đặt Photoshop và bộ action chuẩn của công ty",
        summary: "Phiên bản Photoshop, cấu hình hiệu năng và cách cài bộ action dùng chung.",
        category: "Phần mềm/Photoshop",
        importance: "important",
        author: "staff6",
        tags: ["photoshop", "action"],
        day: "2026-08-25",
        body: [
          { ol: ["Cài Photoshop bản đang dùng trong công ty (xem bảng phần mềm).", "Đặt RAM cho Photoshop 70%, scratch disk ổ SSD riêng.", "Nạp bộ action từ ổ đĩa chung (IT › Action chuẩn)."] }
        ],
        status: "Đã ban hành",
        revisions: [{ day: "2026-09-22", by: "lead2", note: "Thêm bước nạp bộ brush làm da" }]
      },
      {
        title: "Hướng dẫn sử dụng Nesso Work cho nhân viên mới",
        summary: "Đăng nhập, xem task được giao, chuyển trạng thái và nhắn tin trong nhóm.",
        category: "Phần mềm/Nesso Work",
        importance: "normal",
        author: "staff6",
        tags: ["nesso work", "nhân viên mới"],
        pinned: true,
        day: "2026-08-26",
        body: [
          { ul: ["Công việc của tôi: các task được giao, sắp theo hạn.", "Sản xuất › Task của tôi: task retouch và QC.", "Tri thức: quy trình, chính sách, hướng dẫn đã được duyệt."] }
        ],
        status: "Đã ban hành"
      },
      {
        title: "Quy định sử dụng ổ đĩa chung và sao lưu dữ liệu",
        summary: "Cấu trúc thư mục, quyền truy cập và lịch sao lưu hằng ngày.",
        category: "Thiết bị",
        importance: "important",
        author: "staff6",
        tags: ["ổ đĩa chung", "sao lưu"],
        day: "2026-08-28",
        body: [
          { p: "Ổ đĩa chung được sao lưu lúc 23:00 hằng ngày. File gốc của khách phải nằm trong thư mục job, không lưu trên máy cá nhân." }
        ],
        status: "Đã ban hành"
      },
      {
        title: "Xử lý sự cố máy tính không nhận màn hình thứ hai",
        category: "Thiết bị",
        importance: "normal",
        author: "lead2",
        tags: ["sự cố", "màn hình"],
        day: "2026-09-16",
        body: [{ ol: ["Kiểm tra cáp và cổng kết nối.", "Windows + P, chọn “Mở rộng”.", "Cập nhật driver card đồ hoạ.", "Vẫn lỗi: tạo yêu cầu hỗ trợ cho IT."] }],
        status: "Đã ban hành"
      },
      {
        title: "Hướng dẫn kết nối VPN khi làm việc từ xa",
        summary: "Cài ứng dụng VPN, kết nối và các lỗi thường gặp.",
        category: "Tài khoản & bảo mật",
        importance: "important",
        author: "staff6",
        tags: ["vpn", "làm việc từ xa"],
        day: "2026-09-02",
        body: [{ ol: ["Cài ứng dụng VPN từ trang hướng dẫn nội bộ.", "Đăng nhập bằng tài khoản công ty.", "Kết nối trước khi mở ổ đĩa chung."] }],
        status: "Cần cập nhật",
        finalStatusBy: "staff6",
        finalStatusDay: "2026-10-01",
        finalStatusReason: "Đổi nhà cung cấp VPN từ tháng 10"
      },
      {
        title: "Hướng dẫn cài đặt máy in tầng 2",
        summary: "Máy in cũ đã thanh lý.",
        category: "Thiết bị",
        importance: "normal",
        author: "staff6",
        tags: ["máy in"],
        day: "2026-08-21",
        body: [{ p: "Thêm máy in qua địa chỉ mạng nội bộ trong Cài đặt › Máy in." }],
        status: "Hết hiệu lực",
        finalStatusBy: "staff6",
        finalStatusDay: "2026-09-25",
        finalStatusReason: "Máy in đã thanh lý"
      }
    ]
  }
];
