"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  FolderOpen,
  Layers,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Collection } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export function Sidebar() {
  const router = useRouter();
  const {
    collections,
    activeCollection,
    setActiveCollection,
    setAddCollectionOpen,
    isSidebarOpen,
  } = useAppStore();

  return (
    <AnimatePresence mode="wait">
      {isSidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0, x: -20 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0, x: -20 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="h-screen border-r border-slate-200 bg-white/85 backdrop-blur-xl"
        >
          <div className="border-b border-slate-200 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-400 text-white shadow-sm">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-slate-900">SocialSpark</h1>
                <p className="text-xs text-slate-500">AI Recreation Console</p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start gap-2">
                <Bot className="mt-0.5 h-4 w-4 text-rose-500" />
                <p className="text-xs leading-relaxed text-slate-600">
                  This workspace is optimized for autonomous operation: deterministic steps, explicit states, and minimal clicks.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Collections
              </span>
              <button
                onClick={() => setAddCollectionOpen(true)}
                className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {collections.length === 0 ? (
                <div className="text-center py-8">
                  <FolderOpen className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                  <p className="text-sm text-slate-500">No collections yet</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setAddCollectionOpen(true)}
                  >
                    Create your first collection
                  </Button>
                </div>
              ) : (
                collections.map((collection) => (
                  <CollectionItem
                    key={collection.id}
                    collection={collection}
                    isActive={activeCollection?.id === collection.id}
                    onClick={() => {
                      setActiveCollection(collection);
                      router.push(`/collections/${collection.id}`);
                    }}
                  />
                ))
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="mb-1 flex items-center gap-2 font-medium text-slate-700">
                <Layers className="h-4 w-4" />
                Workspace status
              </div>
              {collections.length} collections available
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function CollectionItem({
  collection,
  isActive,
  onClick,
}: {
  collection: Collection;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 1 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
        isActive
          ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      )}
    >
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold", isActive ? "bg-rose-500 text-white" : "bg-slate-200 text-slate-600")}>
        {collection.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{collection.name}</p>
        <p className="truncate text-xs text-slate-500">{collection.app_name}</p>
      </div>
    </motion.button>
  );
}
