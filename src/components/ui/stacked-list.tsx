"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Search, UserRound, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/core/utils";

export type StackedListRoleType = "pm" | "designer" | "data" | "creator";

export interface StackedListMember {
  id: string;
  name: string;
  status: string;
  online?: boolean;
  role: string;
  roleType: StackedListRoleType;
  avatar?: string;
  avatarNode?: ReactNode;
  disabled?: boolean;
  statusTone?: "default" | "success" | "warning" | "danger";
  action?: {
    label: string;
    type?: "add" | "remove";
    disabled?: boolean;
    onClick: () => void;
  };
}

type StackedListProps = {
  activeMembers: StackedListMember[];
  directoryMembers: StackedListMember[];
  title?: string;
  directoryTitle?: string;
  directorySubtitle?: string;
  searchPlaceholder?: string;
  directorySearchPlaceholder?: string;
  emptyActiveLabel?: string;
  emptyDirectoryLabel?: string;
  onAddClick?: () => void;
  className?: string;
};

const sweepSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 35,
  mass: 0.5,
};

function getInitials(name: string) {
  return name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || name.slice(0, 2).toUpperCase();
}

function MemberAvatar({ member }: { member: StackedListMember }) {
  if (member.avatarNode) {
    return <>{member.avatarNode}</>;
  }

  if (member.avatar) {
    return (
      <img
        src={member.avatar}
        alt={member.name}
        className="h-9 w-9 rounded-full object-cover shadow-sm ring-2 ring-background grayscale-[0.1] transition-all duration-300 group-hover:grayscale-0"
      />
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground shadow-sm ring-2 ring-background">
      {getInitials(member.name)}
    </div>
  );
}

function statusClass(member: StackedListMember) {
  if (member.statusTone === "danger") return "text-destructive";
  if (member.statusTone === "warning") return "text-amber-600 dark:text-amber-300";
  if (member.online || member.statusTone === "success") return "text-green-600 dark:text-green-400";
  return "text-muted-foreground";
}

function MemberItem({ member }: { member: StackedListMember }) {
  const ActionIcon = member.action?.type === "remove" ? X : Plus;

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: 10, y: 15, rotate: 1 },
        visible: { opacity: 1, x: 0, y: 0, rotate: 0 },
      }}
      transition={sweepSpring}
      style={{ originX: 1, originY: 1 }}
      className={cn(
        "group flex items-center border-b border-border/40 py-2.5 first:pt-0 last:border-0",
        member.disabled && "opacity-55"
      )}
    >
      <div className="relative mr-3 shrink-0">
        <MemberAvatar member={member} />
        {member.online ? (
          <div className="absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center rounded-full bg-background shadow-sm">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1 truncate text-sm font-medium leading-none tracking-normal text-foreground">
          {member.name}
        </h3>
        <div className="flex items-center gap-1.5 opacity-80">
          {member.online ? <div className="h-1.5 w-1.5 rounded-full bg-green-500" /> : null}
          <p className={cn("truncate text-xs font-medium leading-none", statusClass(member))}>
            {member.status}
          </p>
        </div>
      </div>
      <div className="ml-2 flex shrink-0 items-center">
        {member.action ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              "h-7 w-7 rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100",
              member.action.type === "remove" && "hover:bg-destructive/10 hover:text-destructive"
            )}
            disabled={member.action.disabled}
            title={member.action.label}
            aria-label={member.action.label}
            onClick={(event) => {
              event.stopPropagation();
              member.action?.onClick();
            }}
          >
            <ActionIcon className="h-[15px] w-[15px]" strokeWidth={2.4} />
          </Button>
        ) : null}
      </div>
    </motion.div>
  );
}

export function StackedList({
  activeMembers,
  directoryMembers,
  title = "Active Members",
  directoryTitle = "Member Directory",
  directorySubtitle,
  searchPlaceholder = "Search teammates...",
  directorySearchPlaceholder = "Search members...",
  emptyActiveLabel = "No active members",
  emptyDirectoryLabel = "No members available",
  onAddClick,
  className,
}: StackedListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredDirectoryMembers = useMemo(
    () => directoryMembers.filter((member) => (
      !normalizedQuery
      || member.name.toLowerCase().includes(normalizedQuery)
      || member.role.toLowerCase().includes(normalizedQuery)
      || member.status.toLowerCase().includes(normalizedQuery)
    )),
    [directoryMembers, normalizedQuery]
  );
  const summaryMembers = directoryMembers.length ? directoryMembers : activeMembers;
  const subtitle = directorySubtitle ?? `${directoryMembers.length} Members Registered`;

  return (
    <div className={cn("relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-none", className)}>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="p-4 pb-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold tracking-normal text-foreground">
              <span className="truncate">{title}</span>
              <span className="mt-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-normal leading-none text-muted-foreground">
                {activeMembers.length}
              </span>
            </h2>
            {onAddClick ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full border-border/50 text-muted-foreground hover:bg-muted/50"
                onClick={onAddClick}
                title="添加成员"
                aria-label="添加成员"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </Button>
            ) : null}
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="h-9 w-full rounded-xl border-none bg-muted/40 pl-9 pr-3 text-sm text-foreground transition-all placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-20">
          {activeMembers.length ? (
            <motion.div
              initial={false}
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
              className="space-y-0.5"
            >
              {activeMembers.map((member) => (
                <MemberItem key={`active-${member.id}`} member={member} />
              ))}
            </motion.div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
              {emptyActiveLabel}
            </div>
          )}
        </div>
      </div>

      <motion.div
        layout
        initial={false}
        animate={{
          height: isExpanded ? "calc(100% - 16px)" : "56px",
          width: isExpanded ? "calc(100% - 16px)" : "calc(100% - 24px)",
          bottom: isExpanded ? "8px" : "12px",
          left: isExpanded ? "8px" : "12px",
          borderRadius: isExpanded ? "18px" : "16px",
        }}
        transition={{
          type: "spring",
          stiffness: 240,
          damping: 30,
          mass: 0.8,
        }}
        className="group/bar absolute z-50 flex flex-col overflow-hidden border border-border bg-card shadow-none"
        style={{ cursor: isExpanded ? "default" : "pointer" }}
        onClick={() => !isExpanded && setIsExpanded(true)}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center justify-between px-3 transition-colors",
            isExpanded ? "border-b border-border/40" : "hover:bg-muted/20"
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground/80 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-transform group-hover/bar:scale-105">
              <UserRound className="h-[17px] w-[17px]" strokeWidth={2} />
            </div>
            <motion.div layout="position" className="min-w-0">
              <h4 className="truncate text-sm font-medium leading-none tracking-normal text-foreground">
                {directoryTitle}
              </h4>
              <p className="mt-1 truncate text-xs font-normal leading-none text-muted-foreground">
                {subtitle}
              </p>
            </motion.div>
          </div>

          <div className="ml-2 flex shrink-0 items-center gap-2">
            {!isExpanded ? (
              <div className="flex -space-x-2.5">
                {summaryMembers.slice(0, 3).map((member) => (
                  <div key={`sum-${member.id}`} className="h-8 w-8 overflow-hidden rounded-full bg-muted shadow-sm ring-1 ring-background">
                    {member.avatarNode ? (
                      <div className="h-full w-full [&>*]:h-full [&>*]:w-full">{member.avatarNode}</div>
                    ) : member.avatar ? (
                      <img src={member.avatar} className="h-full w-full object-cover" alt={member.name} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
                        {getInitials(member.name)}
                      </div>
                    )}
                  </div>
                ))}
                {summaryMembers.length > 3 ? (
                  <div className="relative z-0 flex h-8 w-8 items-center justify-center rounded-full bg-muted shadow-sm ring-1 ring-background">
                    <span className="text-xs font-normal leading-none text-muted-foreground">
                      +{summaryMembers.length - 3}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground transition-all hover:text-foreground active:scale-90"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsExpanded(false);
                }}
                aria-label="收起成员目录"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence>
            {isExpanded ? (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="px-4 py-3"
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    placeholder={directorySearchPlaceholder}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="h-9 w-full rounded-lg border-none bg-muted/30 pl-9 text-sm text-foreground transition-all placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-border"
                  />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-1.5">
            {filteredDirectoryMembers.length ? (
              <motion.div
                initial="hidden"
                animate={isExpanded ? "visible" : "hidden"}
                variants={{
                  visible: {
                    transition: { staggerChildren: 0.03, delayChildren: 0.1 },
                  },
                  hidden: {
                    transition: { staggerChildren: 0.02, staggerDirection: -1 },
                  },
                }}
                className="space-y-0.5"
              >
                {filteredDirectoryMembers.map((member) => (
                  <MemberItem key={`list-${member.id}`} member={member} />
                ))}
              </motion.div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-foreground">
                {emptyDirectoryLabel}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default StackedList;
