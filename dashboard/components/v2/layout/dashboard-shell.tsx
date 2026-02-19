'use client';

import { Loader2 } from 'lucide-react';
import { useDashboardStore } from '@/stores/dashboard';
import { useProjectsStore } from '@/stores/projects';
import { useAgentsStore } from '@/stores/agents';
import { useFeedStore } from '@/stores/feed';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { FeedViewToggles } from '@/components/v2/agent-chips';
import { DeployAgentDialog } from '@/components/v2/deploy-agent-dialog';
import { SecretsDialog } from '@/components/v2/secrets-dialog';
import { SwimLanes } from '@/components/v2/swim-lanes';
import { FileTree } from '@/components/v2/file-tree';
import { ScreenPanel } from '@/components/v2/screen-panel';
import { RightPanelTabs } from '@/components/v2/right-panel-tabs';
import { Composer } from '@/components/v2/composer';
import { StatusBar } from './status-bar';
import { SummaryFeed } from '../feed/summary-feed';

/** Isolates feed/agent loading state so DashboardShell doesn't re-render on data changes */
function FeedSection() {
  const feedFetching = useFeedStore((s) => s.fetching);
  const feedCount = useFeedStore((s) => s.items.length);
  const agentsFetching = useAgentsStore((s) => s.fetching);
  const loading = agentsFetching || feedFetching;

  if (loading && feedCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          <span className="text-xs font-mono text-muted-foreground">Loading feed...</span>
        </div>
      </div>
    );
  }

  if (feedCount === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-xs font-mono text-muted-foreground">No feed items yet</span>
      </div>
    );
  }

  return <SummaryFeed />;
}

export function DashboardShell() {
  const rightTab = useDashboardStore((s) => s.rightTab);
  const deployDialogOpen = useDashboardStore((s) => s.deployDialogOpen);
  const setDeployDialogOpen = useDashboardStore((s) => s.setDeployDialogOpen);
  const secretsDialogOpen = useDashboardStore((s) => s.secretsDialogOpen);
  const setSecretsDialogOpen = useDashboardStore((s) => s.setSecretsDialogOpen);
  const projectId = useProjectsStore((s) => s.currentProjectId);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <StatusBar />

      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Left column: Feed */}
        <ResizablePanel defaultSize={55} minSize={25} className="relative flex flex-col overflow-hidden">
          <FeedViewToggles />
          <FeedSection />
          <Composer />
        </ResizablePanel>

        <ResizableHandle />

        {/* Right column: Timeline / Files / Screen */}
        <ResizablePanel
          defaultSize={45}
          minSize={20}
          className={`flex flex-col overflow-hidden ${rightTab === 'screen' ? '' : 'p-3'}`}
        >
          {rightTab === 'screen' ? (
            <>
              <div className="px-3 pt-3">
                <RightPanelTabs />
              </div>
              <ScreenPanel />
            </>
          ) : (
            <>
              <RightPanelTabs />
              {rightTab === 'timeline' ? <SwimLanes /> : <FileTree />}
            </>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      <DeployAgentDialog
        open={deployDialogOpen}
        onOpenChange={setDeployDialogOpen}
        projectId={projectId!}
      />
      <SecretsDialog
        open={secretsDialogOpen}
        onOpenChange={setSecretsDialogOpen}
        projectId={projectId!}
      />
    </div>
  );
}
