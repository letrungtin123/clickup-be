import { registerUniqueViolations } from "../../lib/db-errors.js";

/** Vietnamese 409 messages for the production module's unique constraints. */
registerUniqueViolations({
  production_teams_name_uidx: { code: "TEAM_NAME_TAKEN", message: "Tên team đã tồn tại." },
  production_clients_name_uidx: { code: "CLIENT_NAME_TAKEN", message: "Tên khách hàng đã tồn tại." },
  production_projects_code_uidx: { code: "PROJECT_CODE_TAKEN", message: "Mã dự án đã tồn tại." },
  production_processes_name_uidx: { code: "PROCESS_NAME_TAKEN", message: "Tên quy trình đã tồn tại." },
  production_processes_single_qc_uidx: { code: "QC_PROCESS_EXISTS", message: "Đã có một quy trình QC đang hoạt động — tắt cờ QC ở quy trình kia trước." },
  production_shifts_name_uidx: { code: "SHIFT_NAME_TAKEN", message: "Tên ca làm đã tồn tại." },
  statuses_organization_id_code_key: { code: "STATUS_CODE_TAKEN", message: "Mã trạng thái đã tồn tại." },
  production_statuses_single_initial_uidx: { code: "INITIAL_STATUS_EXISTS", message: "Chỉ được có một trạng thái khởi tạo." },
  custom_fields_organization_id_entity_key_key: { code: "FIELD_KEY_TAKEN", message: "Mã trường đã tồn tại cho đối tượng này." },
  production_tags_name_uidx: { code: "TAG_NAME_TAKEN", message: "Tên tag đã tồn tại." },
  production_jobs_code_uidx: { code: "JOB_CODE_TAKEN", message: "Mã job đã tồn tại." },
  production_kpi_targets_version_uidx: { code: "KPI_VERSION_EXISTS", message: "Đã có chỉ tiêu KPI bắt đầu từ ngày này." }
});
