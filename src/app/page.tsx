'use client';

import React, { useState } from 'react';
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

  const startResizing = React.useCallback(() => {
    setIsResizing(true);
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
          onToggleAI={() => setIsAIPanelOpen(!isAIPanelOpen)}
          isAIPanelOpen={isAIPanelOpen}
        />
      </div>

      {isAIPanelOpen && (
        <div
          className={styles.resizeHandle}
          onMouseDown={startResizing}
        />
      )}

      <div
        className={styles.aiPanelContainer}
        style={{
          width: isAIPanelOpen ? `${panelWidth}px` : '0px',
          minWidth: isAIPanelOpen ? 'auto' : '0px', // Allow minWidth to be auto when open, 0 when closed
          opacity: isAIPanelOpen ? 1 : 0,
          pointerEvents: isAIPanelOpen ? 'auto' : 'none',
        }}
      >
        <AIPanel />
      </div>
    </main>
  );
}
