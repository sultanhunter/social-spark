"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen,
  Plus,
  ChevronRight,
  Sparkles,
  Archive,
  Settings,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Collection } from "@/lib/supabase";

export function Sidebar() {
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
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="h-screen bg-zinc-950/50 backdrop-blur-2xl border-r border-zinc-800/50 flex flex-col overflow-hidden"
        >
          {/* Logo */}
          <div className="p-6 border-b border-zinc-800/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white tracking-tight">
                  SocialSpark
                </h1>
                <p className="text-xs text-zinc-500">Content Recreation</p>
              </div>
            </div>
          </div>

          {/* Collections */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Collections
              </span>
              <button
                onClick={() => setAddCollectionOpen(true)}
                className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              {collections.length === 0 ? (
                <div className="text-center py-8">
                  <FolderOpen className="w-10 h-10 text-zinc-700 mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">No collections yet</p>
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
                    onClick={() => setActiveCollection(collection)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="p-4 border-t border-zinc-800/50 space-y-1">
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors text-sm">
              <Archive className="w-4 h-4" />
              <span>All Posts</span>
            </button>
            <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors text-sm">
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
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
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left",
        isActive
          ? "bg-zinc-800/80 text-white shadow-lg shadow-zinc-900/50"
          : "text-zinc-400 hover:text-white hover:bg-zinc-800/30"
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-medium",
          isActive
            ? "bg-gradient-to-br from-blue-500 to-violet-600 text-white"
            : "bg-zinc-800 text-zinc-400"
        )}
      >
        {collection.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{collection.name}</p>
        <p className="text-xs text-zinc-500 truncate">{collection.app_name}</p>
      </div>
      <ChevronRight
        className={cn(
          "w-4 h-4 transition-transform",
          isActive ? "text-zinc-400" : "text-zinc-600"
        )}
      />
    </motion.button>
  );
}
