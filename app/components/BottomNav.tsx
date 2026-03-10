"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", icon: "🏠", label: "ホーム" },
  { href: "/map", icon: "🗺️", label: "マップ" },
  { href: "/actions", icon: "✅", label: "タスク" },
  { href: "/topics", icon: "🏷️", label: "トピック" },
  { href: "/contacts", icon: "📇", label: "連絡先" },
];

export default function BottomNav() {
  const pathname = usePathname();

  // 録音中・結果・取り込みページでは非表示
  if (pathname.includes("/record") || pathname.includes("/import") || pathname.includes("/recall") || pathname.includes("/result")) return null;
  if (pathname.startsWith("/auth") || pathname.startsWith("/share")) return null;

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 safe-area-pb">
      <div className="max-w-2xl mx-auto flex">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
              isActive(item.href) ? "text-indigo-600" : "text-gray-400 hover:text-gray-600"
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-xs font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
