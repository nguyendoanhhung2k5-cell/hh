export type PoolTable = {
  id: string;
  name: string;
  number: number;
  hourlyRate: number;
  active: boolean;
};

export type PlaySession = {
  id: string;
  code: string;
  tableId: string | null;
  tableName: string;
  tableNumber: number | null;
  status: "Đang chơi" | "Đã kết thúc";
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  hourlyRate: number;
  amount: number | null;
  note: string;
};

export type PosSnapshot = {
  tables: PoolTable[];
  sessions: PlaySession[];
  errors: {
    tables?: string;
    sessions?: string;
  };
  loadedAt: string;
};

export type ActionResult = {
  success: boolean;
  message: string;
};
