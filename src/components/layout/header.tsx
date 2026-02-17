"use client";

import { Menu, Search, Bell, Github } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

export function Header() {
  const { toggleSidebar, currentStep, setCurrentStep, activeCollection } =
    useAppStore();

  return (
    <header className="h-16 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-2xl sticky top-0 z-40">
      <div className="h-full px-4 flex items-center justify-between gap-4">
        {/* Left Section */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Step Toggle */}
          <div className="flex items-center bg-zinc-900/50 rounded-xl p-1 border border-zinc-800/50">
            <StepButton
              label="Storage"
              step="storage"
              currentStep={currentStep}
              onClick={() => setCurrentStep("storage")}
            />
            <StepButton
              label="Recreation"
              step="recreation"
              currentStep={currentStep}
              onClick={() => setCurrentStep("recreation")}
            />
          </div>
        </div>

        {/* Center - Search */}
        <div className="flex-1 max-w-md">
          <Input
            placeholder="Search posts..."
            icon={<Search className="w-4 h-4" />}
            className="bg-zinc-900/30"
          />
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2">
          {activeCollection && !activeCollection.github_repo && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => useAppStore.getState().setConnectRepoOpen(true)}
              className="gap-2"
            >
              <Github className="w-4 h-4" />
              Connect Repo
            </Button>
          )}
          <button className="p-2 rounded-xl hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full" />
          </button>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-sm font-medium ml-2">
            U
          </div>
        </div>
      </div>
    </header>
  );
}

function StepButton({
  label,
  step,
  currentStep,
  onClick,
}: {
  label: string;
  step: "storage" | "recreation";
  currentStep: string;
  onClick: () => void;
}) {
  const isActive = step === currentStep;

  return (
    <button
      onClick={onClick}
      className="relative px-4 py-2 text-sm font-medium rounded-lg transition-colors"
    >
      {isActive && (
        <motion.div
          layoutId="activeStep"
          className="absolute inset-0 bg-zinc-800 rounded-lg"
          transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
        />
      )}
      <span
        className={`relative z-10 ${isActive ? "text-white" : "text-zinc-500 hover:text-zinc-300"}`}
      >
        {label}
      </span>
    </button>
  );
}
