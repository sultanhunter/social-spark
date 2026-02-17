"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AddPostModal } from "@/components/posts/add-post-modal";
import { AddCollectionModal } from "@/components/collections/add-collection-modal";

interface AppShellProps {
  children: React.ReactNode;
  collectionId?: string;
}

export function AppShell({ children, collectionId }: AppShellProps) {
  const {
    collections,
    setCollections,
    setPosts,
    setActiveCollection,
    setCollectionsLoading,
    setPostsLoading,
  } = useAppStore();

  useEffect(() => {
    let isMounted = true;

    async function fetchCollections() {
      setCollectionsLoading(true);

      try {
        const response = await fetch("/api/collections");
        if (!response.ok) return;

        const data = await response.json();
        if (!isMounted) return;
        setCollections(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to fetch collections:", err);
      } finally {
        if (isMounted) setCollectionsLoading(false);
      }
    }

    fetchCollections();

    return () => {
      isMounted = false;
    };
  }, [setCollections, setCollectionsLoading]);

  useEffect(() => {
    if (!collectionId) {
      setActiveCollection(null);
      setPosts([]);
      return;
    }

    const matchedCollection = collections.find((collection) => collection.id === collectionId) || null;
    setActiveCollection(matchedCollection);
  }, [collectionId, collections, setActiveCollection, setPosts]);

  useEffect(() => {
    let isMounted = true;

    async function fetchPosts() {
      if (!collectionId) {
        setPosts([]);
        return;
      }

      setPostsLoading(true);

      try {
        const response = await fetch(`/api/posts/${collectionId}`);
        if (!response.ok) {
          if (isMounted) setPosts([]);
          return;
        }

        const data = await response.json();
        if (!isMounted) return;
        setPosts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to fetch posts:", err);
      } finally {
        if (isMounted) setPostsLoading(false);
      }
    }

    fetchPosts();

    return () => {
      isMounted = false;
    };
  }, [collectionId, setPosts, setPostsLoading]);

  return (
    <div className="flex h-screen overflow-hidden bg-transparent">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        {children}
      </div>

      <AddPostModal />
      <AddCollectionModal />
    </div>
  );
}
