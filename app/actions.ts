"use server";

import { createRecord, sqlQuery, updateRecord } from "@/lib/teable";
import type {
  ActionResult,
  PlaySession,
  PoolTable,
  PosSnapshot,
} from "@/lib/pos-types";

const BASE_ID = "bsergmh3mri6WbeJ1up";
const TABLES_TABLE_ID = "tblGGLa2q8ttpwWExFJ";
const SESSIONS_TABLE_ID = "tbllSo444lJ3SMbpH1v";
const TABLES_SQL_NAME = `"${BASE_ID}"."${TABLES_TABLE_ID}"`;
const SESSIONS_SQL_NAME = `"${BASE_ID}"."${SESSIONS_TABLE_ID}"`;

const FIELDS = {
  table: {
    active: "fldmuAfVaWfbObXAF9M",
    hourlyRate: "fld8l4ypdnrl8XgxovD",
  },
  session: {
    code: "fldaC1o0HynTEMwFBIR",
    minutes: "fldaU4zPEQzqYfLlb2c",
    endedAt: "fldXpEZNRxJ37TFO8Vb",
    amount: "fldb9jIWXpjJsrxA6wz",
    startedAt: "fldKmFOXV7w4i5sldat",
    status: "fldbNAWsIo03xP6UQlD",
    hourlyRate: "fldDDzeCCZRkIkV8zi6",
    table: "fldJnNLjMHfO1eqKCcH",
  },
} as const;

const RECORD_ID_PATTERN = /^rec[A-Za-z0-9]+$/;

class PosActionError extends Error {}

function requireRecordId(value: string, label: string) {
  if (!RECORD_ID_PATTERN.test(value)) {
    throw new PosActionError(`${label} không hợp lệ.`);
  }
  return value;
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function publicFailure(error: unknown, fallback: string): ActionResult {
  console.error(fallback, error);
  return {
    success: false,
    message: error instanceof PosActionError ? error.message : fallback,
  };
}

async function queryTables(): Promise<PoolTable[]> {
  const { rows } = await sqlQuery(
    BASE_ID,
    `SELECT "__id", "Ten_ban", "So_ban", "Gia_theo_gio", "Hoat_dong"
     FROM ${TABLES_SQL_NAME}
     ORDER BY CAST("So_ban" AS numeric) ASC
     LIMIT 100`
  );

  return rows.map((row) => ({
    id: stringValue(row.__id),
    name: stringValue(row.Ten_ban, "Bàn chưa đặt tên"),
    number: numberValue(row.So_ban),
    hourlyRate: numberValue(row.Gia_theo_gio),
    active: row.Hoat_dong === true,
  }));
}

async function querySessions(): Promise<PlaySession[]> {
  const { rows } = await sqlQuery(
    BASE_ID,
    `SELECT "__id", "Ma_phien", "Trang_thai", "Gio_bat_dau", "Gio_ket_thuc",
            "So_phut", "Don_gia_theo_gio", "Thanh_tien", "Ghi_chu",
            "__fk_fldJnNLjMHfO1eqKCcH"
     FROM ${SESSIONS_SQL_NAME}
     WHERE "Ma_phien" IS NOT NULL
     ORDER BY "Gio_bat_dau" DESC NULLS LAST
     LIMIT 500`
  );

  return rows.map((row) => ({
    id: stringValue(row.__id),
    code: stringValue(row.Ma_phien),
    tableId: stringValue(row.__fk_fldJnNLjMHfO1eqKCcH) || null,
    tableName: "Bàn không xác định",
    tableNumber: null,
    status:
      row.Trang_thai === "Đang chơi" ? "Đang chơi" : "Đã kết thúc",
    startedAt: stringValue(row.Gio_bat_dau),
    endedAt: stringValue(row.Gio_ket_thuc) || null,
    minutes:
      row.So_phut === null || row.So_phut === undefined
        ? null
        : numberValue(row.So_phut),
    hourlyRate: numberValue(row.Don_gia_theo_gio),
    amount:
      row.Thanh_tien === null || row.Thanh_tien === undefined
        ? null
        : numberValue(row.Thanh_tien),
    note: stringValue(row.Ghi_chu),
  }));
}

export async function loadPosData(): Promise<PosSnapshot> {
  const [tablesResult, sessionsResult] = await Promise.allSettled([
    queryTables(),
    querySessions(),
  ]);

  const tables = tablesResult.status === "fulfilled" ? tablesResult.value : [];
  const tableMap = new Map(tables.map((table) => [table.id, table]));
  const sessions =
    sessionsResult.status === "fulfilled"
      ? sessionsResult.value.map((session) => {
          const table = session.tableId ? tableMap.get(session.tableId) : undefined;
          return {
            ...session,
            tableName: table?.name ?? session.tableName,
            tableNumber: table?.number ?? null,
          };
        })
      : [];

  if (tablesResult.status === "rejected") {
    console.error("Không thể tải danh sách bàn", tablesResult.reason);
  }
  if (sessionsResult.status === "rejected") {
    console.error("Không thể tải danh sách phiên chơi", sessionsResult.reason);
  }

  return {
    tables,
    sessions,
    errors: {
      ...(tablesResult.status === "rejected"
        ? { tables: "Không thể tải danh sách bàn. Vui lòng thử lại." }
        : {}),
      ...(sessionsResult.status === "rejected"
        ? { sessions: "Không thể tải phiên chơi. Vui lòng thử lại." }
        : {}),
    },
    loadedAt: new Date().toISOString(),
  };
}

export async function openTable(tableId: string): Promise<ActionResult> {
  try {
    requireRecordId(tableId, "Bàn");

    const { rows: tableRows } = await sqlQuery(
      BASE_ID,
      `SELECT "__id", "Ten_ban", "So_ban", "Gia_theo_gio", "Hoat_dong"
       FROM ${TABLES_SQL_NAME}
       WHERE "__id" = '${tableId}'
       LIMIT 1`
    );
    const table = tableRows[0];

    if (!table) {
      throw new PosActionError("Không tìm thấy bàn này.");
    }
    if (table.Hoat_dong !== true) {
      throw new PosActionError("Bàn đang tạm ngưng, không thể mở phiên mới.");
    }

    const hourlyRate = numberValue(table.Gia_theo_gio);
    if (hourlyRate <= 0) {
      throw new PosActionError("Đơn giá của bàn chưa hợp lệ.");
    }

    const { rows: activeRows } = await sqlQuery(
      BASE_ID,
      `SELECT "__id"
       FROM ${SESSIONS_SQL_NAME}
       WHERE "__fk_fldJnNLjMHfO1eqKCcH" = '${tableId}'
         AND "Trang_thai" = 'Đang chơi'
       LIMIT 1`
    );
    if (activeRows.length > 0) {
      throw new PosActionError("Bàn này đã có phiên đang chơi. Hãy làm mới dữ liệu.");
    }

    const now = new Date();
    const tableNumber = Math.trunc(numberValue(table.So_ban));
    const timestamp = now.toISOString().replace(/[-:.TZ]/g, "");
    const sessionCode = `BAN-${String(tableNumber).padStart(2, "0")}-${timestamp}`;

    await createRecord(SESSIONS_TABLE_ID, {
      [FIELDS.session.code]: sessionCode,
      [FIELDS.session.table]: [tableId],
      [FIELDS.session.status]: "Đang chơi",
      [FIELDS.session.startedAt]: now.toISOString(),
      [FIELDS.session.hourlyRate]: hourlyRate,
    });

    return { success: true, message: `Đã mở ${stringValue(table.Ten_ban)}.` };
  } catch (error) {
    return publicFailure(error, "Không thể mở bàn lúc này. Vui lòng thử lại.");
  }
}

export async function finishSession(sessionId: string): Promise<ActionResult> {
  try {
    requireRecordId(sessionId, "Phiên chơi");

    const { rows } = await sqlQuery(
      BASE_ID,
      `SELECT "__id", "Gio_bat_dau", "Don_gia_theo_gio", "Trang_thai"
       FROM ${SESSIONS_SQL_NAME}
       WHERE "__id" = '${sessionId}'
       LIMIT 1`
    );
    const session = rows[0];

    if (!session) {
      throw new PosActionError("Không tìm thấy phiên chơi này.");
    }
    if (session.Trang_thai !== "Đang chơi") {
      throw new PosActionError("Phiên chơi này đã được kết thúc trước đó.");
    }

    const startedAtMs = Date.parse(stringValue(session.Gio_bat_dau));
    const hourlyRate = numberValue(session.Don_gia_theo_gio);
    if (!Number.isFinite(startedAtMs) || hourlyRate <= 0) {
      throw new PosActionError("Dữ liệu giờ bắt đầu hoặc đơn giá không hợp lệ.");
    }

    const endedAt = new Date();
    const elapsedMs = Math.max(0, endedAt.getTime() - startedAtMs);
    const minutes = Math.round((elapsedMs / 60_000) * 100) / 100;
    const amount = Math.round((elapsedMs * hourlyRate) / 3_600_000);

    await updateRecord(SESSIONS_TABLE_ID, sessionId, {
      [FIELDS.session.status]: "Đã kết thúc",
      [FIELDS.session.endedAt]: endedAt.toISOString(),
      [FIELDS.session.minutes]: minutes,
      [FIELDS.session.amount]: amount,
    });

    return { success: true, message: "Đã kết thúc phiên và chốt tiền." };
  } catch (error) {
    return publicFailure(error, "Không thể kết thúc phiên lúc này. Vui lòng thử lại.");
  }
}

export async function updateTableSettings(
  tableId: string,
  hourlyRate: number,
  active: boolean
): Promise<ActionResult> {
  try {
    requireRecordId(tableId, "Bàn");
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0 || hourlyRate > 10_000_000) {
      throw new PosActionError("Giá theo giờ phải lớn hơn 0 và không quá 10.000.000 ₫.");
    }
    if (typeof active !== "boolean") {
      throw new PosActionError("Trạng thái hoạt động không hợp lệ.");
    }

    const { rows: tableRows } = await sqlQuery(
      BASE_ID,
      `SELECT "__id", "Ten_ban" FROM ${TABLES_SQL_NAME}
       WHERE "__id" = '${tableId}' LIMIT 1`
    );
    if (!tableRows[0]) {
      throw new PosActionError("Không tìm thấy bàn này.");
    }

    if (!active) {
      const { rows: activeRows } = await sqlQuery(
        BASE_ID,
        `SELECT "__id" FROM ${SESSIONS_SQL_NAME}
         WHERE "__fk_fldJnNLjMHfO1eqKCcH" = '${tableId}'
           AND "Trang_thai" = 'Đang chơi'
         LIMIT 1`
      );
      if (activeRows.length > 0) {
        throw new PosActionError("Hãy kết thúc phiên đang chơi trước khi tắt bàn.");
      }
    }

    await updateRecord(TABLES_TABLE_ID, tableId, {
      [FIELDS.table.hourlyRate]: Math.round(hourlyRate),
      [FIELDS.table.active]: active,
    });

    return { success: true, message: `Đã lưu cài đặt ${stringValue(tableRows[0].Ten_ban)}.` };
  } catch (error) {
    return publicFailure(error, "Không thể lưu cài đặt bàn. Vui lòng thử lại.");
  }
}
