import { create } from "zustand";
import { Collection, SavedPost } from "@/lib/supabase";

interface AppState {
  // Collections
  collections: Collection[];
  activeCollection: Collection | null;
  setCollections: (collections: Collection[]) => void;
  setActiveCollection: (collection: Collection | null) => void;
  addCollection: (collection: Collection) => void;
  updateCollection: (id: string, updates: Partial<Collection>) => void;
  
  // Posts
  posts: SavedPost[];
  selectedPost: SavedPost | null;
  postFilter: "all" | "image_slides" | "short_video";
  setPosts: (posts: SavedPost[]) => void;
  setSelectedPost: (post: SavedPost | null) => void;
  setPostFilter: (filter: "all" | "image_slides" | "short_video") => void;
  addPost: (post: SavedPost) => void;
  
  // UI State
  currentStep: "storage" | "recreation";
  setCurrentStep: (step: "storage" | "recreation") => void;
  isCollectionsLoading: boolean;
  setCollectionsLoading: (loading: boolean) => void;
  isPostsLoading: boolean;
  setPostsLoading: (loading: boolean) => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  
  // Modals
  isAddCollectionOpen: boolean;
  setAddCollectionOpen: (open: boolean) => void;
  isAddPostOpen: boolean;
  setAddPostOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Collections
  collections: [],
  activeCollection: null,
  setCollections: (collections) => set({ collections }),
  setActiveCollection: (collection) => set({ activeCollection: collection }),
  addCollection: (collection) =>
    set((state) => ({ collections: [...state.collections, collection] })),
  updateCollection: (id, updates) =>
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
      activeCollection:
        state.activeCollection?.id === id
          ? { ...state.activeCollection, ...updates }
          : state.activeCollection,
    })),

  // Posts
  posts: [],
  selectedPost: null,
  postFilter: "all",
  setPosts: (posts) => set({ posts }),
  setSelectedPost: (post) => set({ selectedPost: post }),
  setPostFilter: (filter) => set({ postFilter: filter }),
  addPost: (post) => set((state) => ({ posts: [...state.posts, post] })),

  // UI State
  currentStep: "storage",
  setCurrentStep: (step) => set({ currentStep: step }),
  isCollectionsLoading: false,
  setCollectionsLoading: (loading) => set({ isCollectionsLoading: loading }),
  isPostsLoading: false,
  setPostsLoading: (loading) => set({ isPostsLoading: loading }),
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  // Modals
  isAddCollectionOpen: false,
  setAddCollectionOpen: (open) => set({ isAddCollectionOpen: open }),
  isAddPostOpen: false,
  setAddPostOpen: (open) => set({ isAddPostOpen: open }),
}));
