"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Clock3,
  History,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Square,
  Table2,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  finishSession,
  loadPosData,
  openTable,
  updateTableSettings,
} from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlaySession, PoolTable, PosSnapshot } from "@/lib/pos-types";
import { cn } from "@/lib/utils";

const TIME_ZONE = "Asia/Bangkok";
const moneyFormatter = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});
const clockFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const timeMinuteFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatMoney(value: number) {
  return moneyFormatter.format(Math.round(Number.isFinite(value) ? value : 0));
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function elapsedSeconds(session: PlaySession, now: number) {
  const startedAt = Date.parse(session.startedAt);
  if (!Number.isFinite(startedAt)) return 0;
  const end = session.endedAt ? Date.parse(session.endedAt) : now;
  return Math.max(0, (end - startedAt) / 1000);
}

function currentAmount(session: PlaySession, now: number) {
  if (session.status === "Đã kết thúc" && session.amount !== null) {
    return session.amount;
  }
  return Math.round((elapsedSeconds(session, now) * session.hourlyRate) / 3600);
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : `${dateFormatter.format(date)} ${timeMinuteFormatter.format(date)}`;
}

function bangkokDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, index) => (
        <div
          key={index}
          className="h-[260px] rounded-[8px] border border-zinc-200 bg-white p-5"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="mt-8 h-4 w-28" />
          <Skeleton className="mt-3 h-8 w-40" />
          <Skeleton className="mt-14 h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Table2;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center border-y border-dashed border-zinc-300 px-4 text-center">
      <Icon className="mb-3 size-8 text-zinc-400" aria-hidden="true" />
      <p className="font-semibold text-zinc-900">{title}</p>
      <p className="mt-1 max-w-md text-sm text-zinc-500">{description}</p>
    </div>
  );
}

function CurrencyInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      disabled={disabled}
      value={focused ? String(value || "") : formatMoney(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "");
        onChange(digits ? Number(digits) : 0);
      }}
      className="h-10 min-w-0 font-semibold tabular-nums"
    />
  );
}

type SettingsDraft = { hourlyRate: number; active: boolean };
type SettingsConfirmation = { table: PoolTable; draft: SettingsDraft };

export function PosDashboard() {
  const [snapshot, setSnapshot] = useState<PosSnapshot | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [finishTarget, setFinishTarget] = useState<PlaySession | null>(null);
  const [settingsConfirmation, setSettingsConfirmation] =
    useState<SettingsConfirmation | null>(null);
  const [settingsDrafts, setSettingsDrafts] = useState<Record<string, SettingsDraft>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchData = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") setInitialLoading(true);
    else setRefreshing(true);

    try {
      setLoadError(null);
      const data = await loadPosData();
      setSnapshot(data);
    } catch (error) {
      console.error("Không thể tải dữ liệu POS", error);
      setLoadError("Không thể kết nối để tải dữ liệu. Vui lòng kiểm tra mạng và thử lại.");
      toast.error("Không thể tải dữ liệu. Vui lòng kiểm tra kết nối và thử lại.");
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData("initial");
  }, [fetchData]);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const nowValue = now ?? 0;
  const activeSessions = useMemo(
    () => snapshot?.sessions.filter((session) => session.status === "Đang chơi") ?? [],
    [snapshot]
  );
  const activeByTable = useMemo(
    () => new Map(activeSessions.map((session) => [session.tableId, session])),
    [activeSessions]
  );
  const temporaryTotal = activeSessions.reduce(
    (total, session) => total + currentAmount(session, nowValue),
    0
  );

  const filteredSessions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");
    return (snapshot?.sessions ?? []).filter((session) => {
      const sessionDate = bangkokDateKey(session.startedAt);
      const matchesSearch =
        !normalizedSearch ||
        session.tableName.toLocaleLowerCase("vi").includes(normalizedSearch) ||
        session.code.toLocaleLowerCase("vi").includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && session.status === "Đang chơi") ||
        (statusFilter === "ended" && session.status === "Đã kết thúc");
      const matchesFrom = !dateFrom || sessionDate >= dateFrom;
      const matchesTo = !dateTo || sessionDate <= dateTo;
      return matchesSearch && matchesStatus && matchesFrom && matchesTo;
    });
  }, [dateFrom, dateTo, search, snapshot, statusFilter]);

  const filteredRevenue = filteredSessions.reduce(
    (total, session) =>
      session.status === "Đã kết thúc" ? total + (session.amount ?? 0) : total,
    0
  );

  async function handleOpen(table: PoolTable) {
    setBusyId(table.id);
    try {
      const result = await openTable(table.id);
      if (result.success) {
        toast.success(result.message);
        await fetchData();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error("Lỗi kết nối khi mở bàn", error);
      toast.error("Mất kết nối khi mở bàn. Vui lòng thử lại.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleFinish() {
    if (!finishTarget) return;
    setBusyId(finishTarget.id);
    try {
      const result = await finishSession(finishTarget.id);
      if (result.success) {
        toast.success(result.message);
        setFinishTarget(null);
        await fetchData();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error("Lỗi kết nối khi kết thúc phiên", error);
      toast.error("Mất kết nối khi kết thúc phiên. Vui lòng thử lại.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveSettings() {
    if (!settingsConfirmation) return;
    const { table, draft } = settingsConfirmation;
    setBusyId(table.id);
    try {
      const result = await updateTableSettings(table.id, draft.hourlyRate, draft.active);
      if (result.success) {
        toast.success(result.message);
        setSettingsConfirmation(null);
        setSettingsDrafts((current) => {
          const next = { ...current };
          delete next[table.id];
          return next;
        });
        await fetchData();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error("Lỗi kết nối khi lưu cài đặt", error);
      toast.error("Mất kết nối khi lưu cài đặt. Vui lòng thử lại.");
    } finally {
      setBusyId(null);
    }
  }

  function getDraft(table: PoolTable): SettingsDraft {
    return settingsDrafts[table.id] ?? {
      hourlyRate: table.hourlyRate,
      active: table.active,
    };
  }

  function updateDraft(table: PoolTable, changes: Partial<SettingsDraft>) {
    setSettingsDrafts((current) => ({
      ...current,
      [table.id]: {
        ...(current[table.id] ?? {
          hourlyRate: table.hourlyRate,
          active: table.active,
        }),
        ...changes,
      },
    }));
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  }

  const hasFilters = Boolean(search || dateFrom || dateTo || statusFilter !== "all");
  const clockText = now ? clockFormatter.format(new Date(now)) : "--:--:--";
  const dateText = now ? dateFormatter.format(new Date(now)) : "--/--/----";

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold sm:text-xl">XE ĐIỆN BÀ VƯƠNG</h1>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 sm:text-sm">
                <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="font-medium tabular-nums text-zinc-700">{clockText}</span>
                <span>{dateText}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing || initialLoading}
              onClick={() => void fetchData()}
              className="shrink-0 lg:hidden"
            >
              <RefreshCw
                className={cn("size-4", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              Làm mới
            </Button>
          </div>

          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <div className="min-w-0 border-l-2 border-amber-500 pl-3">
              <p className="text-[11px] font-medium text-zinc-500 sm:text-xs">Đang chơi</p>
              <p className="text-base font-bold tabular-nums text-zinc-900">
                {activeSessions.length} <span className="text-xs font-medium text-zinc-500">bàn</span>
              </p>
            </div>
            <div className="min-w-0 border-l-2 border-emerald-600 pl-3">
              <p className="text-[11px] font-medium text-zinc-500 sm:text-xs">Tạm tính</p>
              <p className="truncate text-base font-bold tabular-nums text-emerald-700 sm:text-lg">
                {formatMoney(temporaryTotal)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing || initialLoading}
              onClick={() => void fetchData()}
              className="hidden shrink-0 lg:inline-flex"
            >
              <RefreshCw
                className={cn("size-4", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              Làm mới
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {loadError || (snapshot && (snapshot.errors.tables || snapshot.errors.sessions)) ? (
          <div className="mb-4 space-y-2" role="alert">
            {[loadError, snapshot?.errors.tables, snapshot?.errors.sessions]
              .filter(Boolean)
              .map((message) => (
                <div
                  key={message}
                  className="flex items-start gap-2 rounded-[8px] border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{message}</span>
                </div>
              ))}
          </div>
        ) : null}

        <Tabs defaultValue="tables" className="w-full">
          <TabsList className="mb-5 grid h-11 w-full grid-cols-3 rounded-[8px] bg-zinc-200 p-1 sm:w-[520px]">
            <TabsTrigger value="tables" className="min-w-0 rounded-md px-2 text-xs sm:text-sm">
              <Table2 className="size-4" aria-hidden="true" />
              <span className="truncate">Bàn chơi</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="min-w-0 rounded-md px-2 text-xs sm:text-sm">
              <History className="size-4" aria-hidden="true" />
              <span className="truncate">Lịch sử</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="min-w-0 rounded-md px-2 text-xs sm:text-sm">
              <Settings2 className="size-4" aria-hidden="true" />
              <span className="truncate">Cài đặt giá</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tables" className="mt-0">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-bold sm:text-lg">Bàn chơi</h2>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {snapshot ? `${snapshot.tables.length} bàn theo thứ tự số bàn` : "Đang tải danh sách bàn"}
                </p>
              </div>
              {refreshing ? (
                <span className="flex items-center gap-1.5 text-xs text-zinc-500" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Đang cập nhật
                </span>
              ) : null}
            </div>

            {initialLoading ? (
              <LoadingGrid />
            ) : !snapshot?.tables.length ? (
              <EmptyState
                icon={Table2}
                title="Chưa có dữ liệu bàn"
                description="Không tìm thấy bàn bi-a nào. Hãy làm mới hoặc kiểm tra bảng Bàn bi-a trong Teable."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {snapshot.tables.map((table) => {
                  const session = activeByTable.get(table.id);
                  const isBusy = busyId === table.id || (session && busyId === session.id);
                  const elapsed = session ? elapsedSeconds(session, nowValue) : 0;
                  return (
                    <article
                      key={table.id}
                      className={cn(
                        "flex min-h-[260px] min-w-0 flex-col rounded-[8px] border bg-white p-4 shadow-sm sm:p-5",
                        session
                          ? "border-amber-400 bg-amber-50/70"
                          : table.active
                            ? "border-emerald-300"
                            : "border-zinc-300 bg-zinc-100"
                      )}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          {table.number === 1 ? (
                            <Image
                              src="/ban-1.webp"
                              alt="Ảnh nhận diện Bàn 1"
                              width={56}
                              height={56}
                              priority
                              className="size-14 shrink-0 rounded-[8px] border border-zinc-300 object-cover"
                            />
                          ) : null}
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase text-zinc-500">
                              Bàn số {table.number}
                            </p>
                            <h3 className="mt-0.5 truncate text-lg font-bold text-zinc-950">
                              {table.name}
                            </h3>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                            session
                              ? "border-amber-400 bg-amber-100 text-amber-900"
                              : table.active
                                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                : "border-zinc-300 bg-zinc-200 text-zinc-600"
                          )}
                        >
                          {session ? "Đang chơi" : table.active ? "Trống" : "Tạm ngưng"}
                        </Badge>
                      </div>

                      {session ? (
                        <div className="mt-5 flex flex-1 flex-col">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                            <div className="min-w-0">
                              <p className="text-xs text-zinc-500">Bắt đầu</p>
                              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">
                                {timeMinuteFormatter.format(new Date(session.startedAt))}
                              </p>
                            </div>
                            <div className="min-w-0 text-right">
                              <p className="text-xs text-zinc-500">Đơn giá</p>
                              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">
                                {formatMoney(session.hourlyRate)}/giờ
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 border-y border-amber-200 py-3">
                            <div className="flex min-w-0 items-end justify-between gap-3">
                              <div className="min-w-0">
                                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-900">
                                  <Timer className="size-3.5" aria-hidden="true" /> Thời gian
                                </p>
                                <p className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-950">
                                  {formatDuration(elapsed)}
                                </p>
                              </div>
                              <div className="min-w-0 text-right">
                                <p className="text-xs font-medium text-amber-900">Tạm tính</p>
                                <p className="mt-1 truncate text-lg font-bold tabular-nums text-amber-800">
                                  {formatMoney(currentAmount(session, nowValue))}
                                </p>
                              </div>
                            </div>
                          </div>
                          <Button
                            type="button"
                            disabled={Boolean(isBusy)}
                            onClick={() => setFinishTarget(session)}
                            className="mt-auto w-full bg-amber-700 text-white hover:bg-amber-800"
                          >
                            {isBusy ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Square className="size-4" aria-hidden="true" />
                            )}
                            Kết thúc
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-5 flex flex-1 flex-col">
                          <div>
                            <p className="text-xs text-zinc-500">Giá theo giờ</p>
                            <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-950">
                              {formatMoney(table.hourlyRate)}
                            </p>
                          </div>
                          {!table.active ? (
                            <p className="mt-3 text-sm text-zinc-500">
                              Bàn đã tắt trong cài đặt và không nhận phiên mới.
                            </p>
                          ) : snapshot.errors.sessions ? (
                            <p className="mt-3 text-sm text-red-700">
                              Chưa xác minh được trạng thái phiên. Hãy làm mới dữ liệu.
                            </p>
                          ) : (
                            <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                              <Check className="size-4" aria-hidden="true" /> Sẵn sàng mở bàn
                            </p>
                          )}
                          <Button
                            type="button"
                            disabled={!table.active || Boolean(snapshot.errors.sessions) || Boolean(isBusy)}
                            onClick={() => void handleOpen(table)}
                            className="mt-auto w-full bg-emerald-700 text-white hover:bg-emerald-800"
                          >
                            {isBusy ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Play className="size-4 fill-current" aria-hidden="true" />
                            )}
                            {table.active ? "Mở bàn" : "Bàn tạm ngưng"}
                          </Button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-0">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-base font-bold sm:text-lg">Lịch sử phiên chơi</h2>
                <p className="mt-0.5 text-sm text-zinc-500">Phiên mới nhất được hiển thị trước</p>
              </div>
              <div className="min-w-0 text-left sm:text-right">
                <p className="text-xs font-medium text-zinc-500">Doanh thu trong bộ lọc</p>
                <p className="truncate text-xl font-bold tabular-nums text-emerald-700">
                  {formatMoney(filteredRevenue)}
                </p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-2 border-y border-zinc-200 bg-white py-3 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_160px_160px_170px_auto]">
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm theo bàn hoặc mã phiên"
                  aria-label="Tìm phiên chơi"
                  className="h-10 pl-9"
                />
              </div>
              <Input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                aria-label="Từ ngày"
                className="h-10"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                aria-label="Đến ngày"
                className="h-10"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-full" aria-label="Lọc trạng thái">
                  <SlidersHorizontal className="size-4 text-zinc-500" aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả trạng thái</SelectItem>
                  <SelectItem value="active">Đang chơi</SelectItem>
                  <SelectItem value="ended">Đã kết thúc</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={!hasFilters}
                onClick={clearFilters}
                className="h-10"
              >
                <X className="size-4" aria-hidden="true" />
                Xóa lọc
              </Button>
            </div>

            {initialLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : snapshot?.errors.sessions ? (
              <EmptyState
                icon={AlertCircle}
                title="Không thể tải lịch sử"
                description="Dữ liệu phiên chơi đang gặp lỗi. Hãy dùng nút Làm mới để thử lại."
              />
            ) : !filteredSessions.length ? (
              <EmptyState
                icon={History}
                title={hasFilters ? "Không có phiên phù hợp" : "Chưa có phiên chơi"}
                description={
                  hasFilters
                    ? "Hãy thay đổi hoặc xóa bộ lọc để xem các phiên khác."
                    : "Các phiên được mở từ màn hình Bàn chơi sẽ xuất hiện tại đây."
                }
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto rounded-[8px] border border-zinc-200 bg-white md:block">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead className="bg-zinc-100 text-left text-xs font-semibold uppercase text-zinc-600">
                      <tr>
                        <th className="px-4 py-3">Bàn</th>
                        <th className="px-4 py-3">Bắt đầu</th>
                        <th className="px-4 py-3">Kết thúc</th>
                        <th className="px-4 py-3">Thời lượng</th>
                        <th className="px-4 py-3 text-right">Đơn giá</th>
                        <th className="px-4 py-3 text-right">Thành tiền</th>
                        <th className="px-4 py-3 text-right">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {filteredSessions.map((session) => (
                        <tr key={session.id} className="hover:bg-zinc-50">
                          <td className="px-4 py-3 font-semibold">{session.tableName}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-700">
                            {formatDateTime(session.startedAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-zinc-700">
                            {formatDateTime(session.endedAt)}
                          </td>
                          <td className="px-4 py-3 font-mono tabular-nums">
                            {formatDuration(elapsedSeconds(session, nowValue))}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                            {formatMoney(session.hourlyRate)}/giờ
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums">
                            {formatMoney(currentAmount(session, nowValue))}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <StatusBadge status={session.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-zinc-200 border-y border-zinc-200 bg-white md:hidden">
                  {filteredSessions.map((session) => (
                    <article key={session.id} className="px-1 py-4">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-bold">{session.tableName}</h3>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">{session.code}</p>
                        </div>
                        <StatusBadge status={session.status} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-500">Bắt đầu</p>
                          <p className="mt-0.5 tabular-nums">{formatDateTime(session.startedAt)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-500">Kết thúc</p>
                          <p className="mt-0.5 tabular-nums">{formatDateTime(session.endedAt)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-500">Thời lượng</p>
                          <p className="mt-0.5 font-mono font-semibold tabular-nums">
                            {formatDuration(elapsedSeconds(session, nowValue))}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-zinc-500">Thành tiền</p>
                          <p className="mt-0.5 font-bold tabular-nums">
                            {formatMoney(currentAmount(session, nowValue))}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="settings" className="mt-0">
            <div className="mb-4">
              <h2 className="text-base font-bold sm:text-lg">Cài đặt giá bàn</h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                Giá mới chỉ áp dụng cho phiên được mở sau khi lưu
              </p>
            </div>

            {initialLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton key={index} className="h-20 w-full" />
                ))}
              </div>
            ) : snapshot?.errors.tables ? (
              <EmptyState
                icon={AlertCircle}
                title="Không thể tải cài đặt bàn"
                description="Danh sách bàn đang gặp lỗi. Hãy dùng nút Làm mới để thử lại."
              />
            ) : !snapshot?.tables.length ? (
              <EmptyState
                icon={Settings2}
                title="Chưa có bàn để cài đặt"
                description="Hãy kiểm tra dữ liệu trong bảng Bàn bi-a."
              />
            ) : (
              <div className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white">
                <div className="hidden grid-cols-[minmax(180px,1fr)_minmax(220px,320px)_160px_110px] gap-4 border-b border-zinc-200 bg-zinc-100 px-4 py-3 text-xs font-semibold uppercase text-zinc-600 md:grid">
                  <span>Bàn</span>
                  <span>Giá theo giờ</span>
                  <span>Hoạt động</span>
                  <span className="text-right">Thao tác</span>
                </div>
                <div className="divide-y divide-zinc-200">
                  {snapshot.tables.map((table) => {
                    const draft = getDraft(table);
                    const changed =
                      draft.hourlyRate !== table.hourlyRate || draft.active !== table.active;
                    const playing = activeByTable.has(table.id);
                    const isBusy = busyId === table.id;
                    return (
                      <div
                        key={table.id}
                        className="grid min-w-0 gap-3 px-4 py-4 md:grid-cols-[minmax(180px,1fr)_minmax(220px,320px)_160px_110px] md:items-center md:gap-4"
                      >
                        <div className="min-w-0">
                          <p className="font-bold">{table.name}</p>
                          <p className="text-xs text-zinc-500">Bàn số {table.number}</p>
                        </div>
                        <div className="min-w-0">
                          <label className="mb-1.5 block text-xs font-medium text-zinc-500 md:hidden">
                            Giá theo giờ
                          </label>
                          <CurrencyInput
                            label={`Giá theo giờ của ${table.name}`}
                            value={draft.hourlyRate}
                            disabled={isBusy}
                            onChange={(hourlyRate) => updateDraft(table, { hourlyRate })}
                          />
                        </div>
                        <div className="flex min-w-0 items-center justify-between gap-3 md:justify-start">
                          <span className="text-sm font-medium text-zinc-700 md:hidden">Hoạt động</span>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={draft.active}
                              disabled={isBusy || (playing && draft.active)}
                              onCheckedChange={(active) => updateDraft(table, { active })}
                              aria-label={`${draft.active ? "Tắt" : "Bật"} ${table.name}`}
                            />
                            <span className="text-sm text-zinc-600">
                              {playing ? "Đang có phiên" : draft.active ? "Đang bật" : "Đã tắt"}
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant={changed ? "default" : "outline"}
                          disabled={!changed || isBusy || draft.hourlyRate <= 0}
                          onClick={() => setSettingsConfirmation({ table, draft })}
                          className="w-full md:w-auto"
                        >
                          {isBusy ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Save className="size-4" aria-hidden="true" />
                          )}
                          Lưu
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog
        open={Boolean(finishTarget)}
        onOpenChange={(open) => {
          if (!open && !busyId) setFinishTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-md rounded-[8px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Kết thúc {finishTarget?.tableName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Xác nhận chốt phiên chơi. Thời gian và thành tiền cuối cùng được tính lại trên máy chủ tại thời điểm xác nhận.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {finishTarget ? (
            <div className="grid grid-cols-2 gap-3 border-y border-zinc-200 py-4">
              <div>
                <p className="text-xs text-zinc-500">Tổng thời gian</p>
                <p className="mt-1 font-mono text-lg font-bold tabular-nums">
                  {formatDuration(elapsedSeconds(finishTarget, nowValue))}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-zinc-500">Tạm tính</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-amber-800">
                  {formatMoney(currentAmount(finishTarget, nowValue))}
                </p>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId === finishTarget?.id}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId === finishTarget?.id}
              onClick={(event) => {
                event.preventDefault();
                void handleFinish();
              }}
              className="bg-amber-700 text-white hover:bg-amber-800"
            >
              {busyId === finishTarget?.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Square className="size-4" aria-hidden="true" />
              )}
              Xác nhận kết thúc
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(settingsConfirmation)}
        onOpenChange={(open) => {
          if (!open && !busyId) setSettingsConfirmation(null);
        }}
      >
        <AlertDialogContent className="max-w-md rounded-[8px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Lưu cài đặt {settingsConfirmation?.table.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Thay đổi sẽ áp dụng cho các phiên mới. Phiên đang chơi vẫn giữ nguyên đơn giá lúc mở bàn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {settingsConfirmation ? (
            <div className="space-y-3 border-y border-zinc-200 py-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Giá theo giờ</span>
                <strong className="tabular-nums">
                  {formatMoney(settingsConfirmation.draft.hourlyRate)}
                </strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-zinc-500">Hoạt động</span>
                <Badge variant="outline">
                  {settingsConfirmation.draft.active ? "Đang bật" : "Đã tắt"}
                </Badge>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId === settingsConfirmation?.table.id}>
              Hủy
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId === settingsConfirmation?.table.id}
              onClick={(event) => {
                event.preventDefault();
                void handleSaveSettings();
              }}
            >
              {busyId === settingsConfirmation?.table.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Xác nhận lưu
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function StatusBadge({ status }: { status: PlaySession["status"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 rounded-full",
        status === "Đang chơi"
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : "border-emerald-300 bg-emerald-50 text-emerald-800"
      )}
    >
      {status}
    </Badge>
  );
}
