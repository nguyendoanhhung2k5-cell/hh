"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-md rounded-[8px] border border-red-200 bg-white p-6 text-center shadow-sm">
        <AlertCircle className="mx-auto size-9 text-red-600" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-bold text-zinc-950">Ứng dụng gặp sự cố</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Không thể hiển thị màn hình quản lý lúc này. Hãy thử tải lại dữ liệu.
        </p>
        <Button type="button" onClick={reset} className="mt-5">
          <RefreshCw className="size-4" aria-hidden="true" />
          Thử lại
        </Button>
      </div>
    </main>
  );
}
