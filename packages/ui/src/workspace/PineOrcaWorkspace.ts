// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

import { TopBar, type TopBarOptions } from '../topbar/TopBar.js';
import { BottomDock, type BottomDockOptions, type DockState } from '../dock/BottomDock.js';
import { StrategyTester } from '../tester/StrategyTester.js';
import { MonacoPineEditor, type MonacoPineEditorOptions, type MonacoRuntime } from '../editor/MonacoPineEditor.js';
import { CrossProbeController } from '../controller/CrossProbeController.js';

export interface PineOrcaWorkspaceOptions {
  topBar?: TopBarOptions;
  initialDockHeight?: number;
  initialDockState?: DockState;
  monacoRuntime?: MonacoRuntime | null;
  initialPineCode?: string;
}

export type WorkspaceResizeCallback = (width: number, height: number) => void;

/**
 * PineOrcaWorkspace: top-level layout orchestrator uniting TopBar, Chart host,
 * BottomDock, StrategyTester, MonacoPineEditor, and CrossProbeController.
 */
export class PineOrcaWorkspace {
  private container: HTMLElement | null = null;
  private rootElement: HTMLElement | null = null;
  private topBarContainer: HTMLElement | null = null;
  private mainArea: HTMLElement | null = null;
  private chartContainer: HTMLElement | null = null;
  private dockContainer: HTMLElement | null = null;

  private topBar: TopBar;
  private bottomDock: BottomDock;
  private strategyTester: StrategyTester;
  private editor: MonacoPineEditor;
  private crossProbeController: CrossProbeController;

  private resizeObserver: ResizeObserver | null = null;
  private resizeListeners = new Set<WorkspaceResizeCallback>();

  constructor(options: PineOrcaWorkspaceOptions = {}) {
    this.topBar = new TopBar(options.topBar);

    this.bottomDock = new BottomDock({
      initialState: options.initialDockState ?? 'split',
      initialHeight: options.initialDockHeight,
    });

    this.strategyTester = new StrategyTester();

    this.editor = new MonacoPineEditor({
      monaco: options.monacoRuntime,
      initialCode: options.initialPineCode,
    });

    this.crossProbeController = new CrossProbeController();
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    this.buildDOM();
    this.setupResizeObserver();
  }

  public destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.crossProbeController.destroy();
    this.editor.destroy();
    this.strategyTester.destroy();
    this.bottomDock.destroy();
    this.topBar.destroy();

    if (this.rootElement && this.rootElement.parentNode) {
      this.rootElement.parentNode.removeChild(this.rootElement);
    }

    this.rootElement = null;
    this.topBarContainer = null;
    this.mainArea = null;
    this.chartContainer = null;
    this.dockContainer = null;
    this.container = null;
    this.resizeListeners.clear();
  }

  public getElement(): HTMLElement | null {
    return this.rootElement;
  }

  public getTopBar(): TopBar {
    return this.topBar;
  }

  public getChartContainer(): HTMLElement {
    if (!this.chartContainer) {
      throw new Error('Workspace must be mounted before accessing chartContainer');
    }
    return this.chartContainer;
  }

  public getBottomDock(): BottomDock {
    return this.bottomDock;
  }

  public getStrategyTester(): StrategyTester {
    return this.strategyTester;
  }

  public getEditor(): MonacoPineEditor {
    return this.editor;
  }

  public getCrossProbeController(): CrossProbeController {
    return this.crossProbeController;
  }

  public onResize(cb: WorkspaceResizeCallback): () => void {
    this.resizeListeners.add(cb);
    return () => this.resizeListeners.delete(cb);
  }

  private buildDOM(): void {
    const root = document.createElement('div');
    root.className = 'pineorca-workspace';
    root.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
      background-color: #131722;
      box-sizing: border-box;
    `;

    // 1. TopBar slot
    this.topBarContainer = document.createElement('div');
    this.topBarContainer.className = 'pineorca-workspace-topbar';
    this.topBarContainer.style.cssText = 'flex: 0 0 auto; width: 100%; z-index: 10;';
    this.topBar.mount(this.topBarContainer);
    root.appendChild(this.topBarContainer);

    // 2. Main Area (Chart + Dock)
    this.mainArea = document.createElement('main');
    this.mainArea.className = 'pineorca-workspace-main';
    this.mainArea.style.cssText = `
      flex: 1 1 auto;
      position: relative;
      display: flex;
      flex-direction: column;
      width: 100%;
      min-height: 0;
      overflow: hidden;
    `;

    // 3. Chart Container
    this.chartContainer = document.createElement('div');
    this.chartContainer.className = 'pineorca-chart-host';
    this.chartContainer.style.cssText = `
      flex: 1 1 auto;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
      background-color: #131722;
    `;
    this.mainArea.appendChild(this.chartContainer);

    // 4. BottomDock Container
    this.dockContainer = document.createElement('div');
    this.dockContainer.className = 'pineorca-dock-host';
    this.dockContainer.style.cssText = `
      flex: 0 0 auto;
      width: 100%;
      position: relative;
      z-index: 5;
    `;
    this.bottomDock.mount(this.dockContainer);
    this.mainArea.appendChild(this.dockContainer);

    // 5. Mount tab contents inside BottomDock
    const testerWrapper = document.createElement('div');
    testerWrapper.className = 'dock-tester-wrapper';
    testerWrapper.style.cssText = 'width: 100%; height: 100%; overflow: hidden;';
    this.strategyTester.mount(testerWrapper);
    this.bottomDock.setTabContent('tester', testerWrapper);

    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'dock-editor-wrapper';
    editorWrapper.style.cssText = 'width: 100%; height: 100%; overflow: hidden;';
    this.editor.mount(editorWrapper);
    this.bottomDock.setTabContent('editor', editorWrapper);

    // 6. Connect CrossProbeController with StrategyTester trade table
    this.crossProbeController.attachTable(this.strategyTester.getListOfTradesTab());

    // 7. Re-trigger layout resizing when dock state or height changes
    this.bottomDock.onHeightChange(() => {
      this.notifyResize();
    });
    this.bottomDock.onStateChange(() => {
      this.notifyResize();
    });

    root.appendChild(this.mainArea);
    this.rootElement = root;
    this.container?.appendChild(root);
  }

  private setupResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined' || !this.chartContainer) return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        for (const listener of this.resizeListeners) {
          listener(width, height);
        }
      }
    });
    this.resizeObserver.observe(this.chartContainer);
  }

  private notifyResize(): void {
    if (!this.chartContainer) return;
    const width = this.chartContainer.clientWidth;
    const height = this.chartContainer.clientHeight;
    for (const listener of this.resizeListeners) {
      listener(width, height);
    }
  }
}
