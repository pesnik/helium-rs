'use client';

import React, { useState } from 'react';
import { FileSystemContext, FileMetadata } from '@/types/ai-types';
import { FileExplorer } from '@/components/FileExplorer';
import { AIPanel } from '@/components/AIPanel';
import { makeStyles, shorthands, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: {
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    background: '#202020',
    color: 'white',
    display: 'flex',
    position: 'relative',
  },
  explorerContainer: {
    flex: 1,
    minWidth: 0,
    height: '100%',
  },
  aiPanelContainer: {
    height: '100%',
    transition: 'width 0.2s ease, opacity 0.2s ease', // Smooth open/close, immediate resize via state
    overflow: 'hidden',
    ...shorthands.borderLeft('1px', 'solid', tokens.colorNeutralStroke1),
    background: tokens.colorNeutralBackground1,
  },
  resizeHandle: {
    width: '4px',
    cursor: 'col-resize',
    height: '100%',
    background: 'transparent',
    transition: 'background 0.2s',
    zIndex: 100,
    position: 'relative',
    marginRight: '-2px',
    marginLeft: '-2px',
    flexShrink: 0, // Prevent handle from shrinking
    ':hover': {
      background: tokens.colorBrandBackground,
    },
  },
});

export default function Home() {
  const styles = useStyles();
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [isManualResize, setIsManualResize] = useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // AI Context State
  const [fsContext, setFsContext] = useState<FileSystemContext | undefined>(undefined);

  const startResizing = React.useCallback(() => {
    if (panelRef.current) {
      setPanelWidth(panelRef.current.clientWidth);
    }
    setIsResizing(true);
    // Don't set manual resize immediately to avoid jump if just clicking without dragging?
    // Actually we need it true so width switches to px mode.
    // By setting panelWidth to current clientWidth first, the switch should be seamless.
    setIsManualResize(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = window.innerWidth - mouseMoveEvent.clientX;
        if (newWidth > 300 && newWidth < 800) {
          setPanelWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  const handleContextChange = React.useCallback((path: string, selectedItems: string[], visibleFiles?: FileMetadata[]) => {
    setFsContext({
      currentPath: path,
      selectedPaths: selectedItems,
      visibleFiles: visibleFiles,
    });
  }, []);

  const toggleAIPanel = () => {
    const newState = !isAIPanelOpen;
    setIsAIPanelOpen(newState);
    if (!newState) {
      // Reset manual resize when closing, so next open is "optimal" again
      setIsManualResize(false);
    }
  };

  React.useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  return (
    <main className={styles.container}>
      <div className={styles.explorerContainer}>
        <FileExplorer
          onToggleAI={toggleAIPanel}
          isAIPanelOpen={isAIPanelOpen}
          onContextChange={handleContextChange}
        />
      </div>

      {isAIPanelOpen && (
        <div
          className={styles.resizeHandle}
          onMouseDown={startResizing}
        />
      )}

      <div
        ref={panelRef}
        className={styles.aiPanelContainer}
        style={{
          width: isAIPanelOpen
            ? (isManualResize ? `${panelWidth}px` : '30vw')
            : '0px',
          minWidth: isAIPanelOpen ? 'auto' : '0px', // Allow minWidth to be auto when open, 0 when closed
          maxWidth: isAIPanelOpen ? '50vw' : '0px', // Prevent it from taking over too much space in auto mode
          opacity: isAIPanelOpen ? 1 : 0,
          pointerEvents: isAIPanelOpen ? 'auto' : 'none',
        }}
      >
        <AIPanel
          isOpen={isAIPanelOpen}
          onClose={toggleAIPanel}
          fsContext={fsContext}
        />
      </div>
    </main>
  );
}
