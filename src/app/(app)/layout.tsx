import { Sidebar } from "@/components/Sidebar";

// All authenticated pages hit the SQLite database. Force runtime rendering so the
// build doesn't try to prerender them (the volume / DB doesn't exist at build time).
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  );
}
