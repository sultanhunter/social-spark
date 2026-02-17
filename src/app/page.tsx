"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { StorageView } from "@/components/views/storage-view";
import { RecreationView } from "@/components/views/recreation-view";
import { AddPostModal } from "@/components/posts/add-post-modal";
import { AddCollectionModal } from "@/components/collections/add-collection-modal";

export default function Home() {
  const {
    currentStep,
    setCollections,
    setPosts,
    activeCollection,
  } = useAppStore();

  // Fetch collections on mount
  useEffect(() => {
    async function fetchCollections() {
      try {
        const response = await fetch("/api/collections");
        if (response.ok) {
          const data = await response.json();
          setCollections(data);
        }
      } catch (err) {
        console.error("Failed to fetch collections:", err);
      }
    }
    fetchCollections();
  }, [setCollections]);

  // Fetch posts when active collection changes
  useEffect(() => {
    async function fetchPosts() {
      if (!activeCollection) {
        setPosts([]);
        return;
      }
      try {
        const response = await fetch(`/api/posts/${activeCollection.id}`);
        if (response.ok) {
          const data = await response.json();
          setPosts(data);
        }
      } catch (err) {
        console.error("Failed to fetch posts:", err);
      }
    }
    fetchPosts();
  }, [activeCollection, setPosts]);

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        
        {/* Content Area */}
        {currentStep === "storage" ? <StorageView /> : <RecreationView />}
      </div>

      {/* Modals */}
      <AddPostModal />
      <AddCollectionModal />
    </div>
  );
}
