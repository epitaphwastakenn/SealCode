import { RefreshIcon } from "~/components/ui/refresh-icon";
import { PlusIcon, SearchIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { HarpMascot } from "../mascot/HarpMascot";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { PullRequestListGhost } from "./PullRequestGhosts";

export function PullRequestListEmptyState({
  query,
  filtered,
  searching,
  hasProjects,
  canLoadMore,
  loadingMore,
  refreshing,
  onClearQuery,
  onLoadMore,
  onRefresh,
}: {
  query: string;
  filtered: boolean;
  searching: boolean;
  hasProjects: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  onClearQuery: () => void;
  onLoadMore: () => void;
  onRefresh: () => void;
}) {
  if (!hasProjects) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <HarpMascot scene="sleeping" className="h-14 w-auto" />
          </EmptyMedia>
          <EmptyTitle>No projects in this workspace</EmptyTitle>
          <EmptyDescription>
            Add a project, and the pull requests from its repository appear here.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
            <PlusIcon className="size-3.5" />
            Add project
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (searching) {
    return (
      <PullRequestListGhost
        rows={5}
        caption={`Searching every host for “${query.length > 48 ? `${query.slice(0, 48)}…` : query}”`}
      />
    );
  }

  if (query.length > 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <HarpMascot scene="ball" className="h-14 w-auto" />
          </EmptyMedia>
          <EmptyTitle>
            Nothing matches “{query.length > 48 ? `${query.slice(0, 48)}…` : query}”
          </EmptyTitle>
          <EmptyDescription>
            The hosts were searched for it. Try fewer words, or search by number, author or branch.
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onClearQuery}>
            <SearchIcon className="size-3.5" />
            Clear search
          </Button>
          <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
            <RefreshIcon size="sm" refreshing={refreshing} />
            {refreshing ? "Checking..." : "Check again"}
          </Button>
        </div>
      </Empty>
    );
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <HarpMascot scene="sleeping" className="h-14 w-auto" />
        </EmptyMedia>
        <EmptyTitle>{filtered ? "Nothing under these filters" : "No pull requests"}</EmptyTitle>
        <EmptyDescription>
          {filtered
            ? "Widen the state, involvement or project filter to see more."
            : "Pull requests from every project in this workspace appear here."}
        </EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-wrap justify-center gap-2">
        {canLoadMore ? (
          <Button size="sm" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading..." : "Load more pull requests"}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
          <RefreshIcon size="sm" refreshing={refreshing} />
          {refreshing ? "Checking..." : "Check again"}
        </Button>
      </div>
    </Empty>
  );
}
