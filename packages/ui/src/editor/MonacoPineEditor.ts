// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export interface EditorDiagnostic {
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
    message: string;
    severity: 'error' | 'warning' | 'info';
}

export type EditorAction = 'save' | 'addToChart' | 'updateStrategy';
export type EditorActionCallback = (action: EditorAction, code: string) => void;

export interface MonacoMarker {
    severity: number;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    message: string;
}

export interface MonacoEditorInstance {
    getValue(): string;
    setValue(value: string): void;
    getModel(): unknown;
    dispose(): void;
    addCommand(keybinding: number, handler: () => void): string | null;
}

export interface MonacoRuntime {
    languages: {
        getLanguages(): Array<{ id: string }>;
        register(language: { id: string; extensions?: string[] }): void;
        setMonarchTokensProvider(languageId: string, provider: unknown): void;
        setLanguageConfiguration(languageId: string, configuration: unknown): void;
    };
    editor: {
        create(element: HTMLElement, options: Record<string, unknown>): MonacoEditorInstance;
        setModelMarkers(model: unknown, owner: string, markers: MonacoMarker[]): void;
    };
    MarkerSeverity: {
        Error: number;
        Warning: number;
        Info: number;
    };
    KeyMod?: {
        CtrlCmd: number;
    };
    KeyCode?: {
        Enter: number;
        KeyS: number;
    };
}

export interface MonacoPineEditorOptions {
    initialCode?: string;
    monaco?: MonacoRuntime | null;
    readOnly?: boolean;
}

export const PINE_LANGUAGE_ID = 'pine';

/**
 * Monarch syntax tokenizer definition for Pine Script v5/v6.
 */
export const PINE_MONARCH_TOKENS_PROVIDER = {
    defaultToken: '',
    tokenPostfix: '.pine',

    keywords: [
        'strategy', 'indicator', 'library',
        'var', 'varip', 'import', 'export', 'type', 'method',
        'if', 'else', 'for', 'to', 'by', 'while', 'switch', 'break', 'continue', 'return',
        'and', 'or', 'not',
        'true', 'false', 'na',
    ],

    typeKeywords: [
        'int', 'float', 'bool', 'string', 'color',
        'line', 'label', 'box', 'table', 'polyline',
        'chart.point', 'series', 'simple', 'const', 'input',
    ],

    namespaces: [
        'ta', 'math', 'request', 'str', 'color', 'time', 'syminfo',
        'timeframe', 'barstate', 'session', 'ticker', 'strategy',
        'indicator', 'box', 'line', 'label', 'table', 'polyline',
        'matrix', 'array', 'map',
    ],

    builtins: [
        'open', 'high', 'low', 'close', 'volume', 'time', 'hl2', 'hlc3', 'ohlc4',
        'bar_index', 'last_bar_index', 'timenow',
        'plot', 'plotshape', 'plotchar', 'plotcandle', 'plotbar', 'plotarrow',
        'hline', 'fill', 'bgcolor', 'barcolor',
        'alert', 'alertcondition',
    ],

    operators: [
        ':=', '=>', '==', '!=', '<=', '>=', '<', '>',
        '=', '+', '-', '*', '/', '%', '?', ':',
    ],

    symbols: /[=><!~?:&|+\-*\/\^%]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
        root: [
            // Compiler directives
            [/^\/\/@version=[56]/, 'annotation'],

            // Identifiers and keywords
            [/[a-zA-Z_]\w*/, {
                cases: {
                    '@keywords': 'keyword',
                    '@typeKeywords': 'type',
                    '@namespaces': 'namespace',
                    '@builtins': 'predefined',
                    '@default': 'identifier',
                },
            }],

            // Whitespace
            { include: '@whitespace' },

            // Delimiters and operators
            [/[{}()\[\]]/, '@brackets'],
            [/@symbols/, {
                cases: {
                    '@operators': 'operator',
                    '@default': '',
                },
            }],

            // Numbers
            [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
            [/0[xX][0-9a-fA-F]+/, 'number.hex'],
            [/\d+/, 'number'],

            // Strings
            [/"([^"\\]|\\.)*$/, 'string.invalid'],
            [/'([^'\\]|\\.)*$/, 'string.invalid'],
            [/"/, 'string', '@string_double'],
            [/'/, 'string', '@string_single'],
        ],

        whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/\/\/.*$/, 'comment'],
        ],

        string_double: [
            [/[^\\"]+/, 'string'],
            [/@escapes/, 'string.escape'],
            [/\\./, 'string.escape.invalid'],
            [/"/, 'string', '@pop'],
        ],

        string_single: [
            [/[^\\']+/, 'string'],
            [/@escapes/, 'string.escape'],
            [/\\./, 'string.escape.invalid'],
            [/'/, 'string', '@pop'],
        ],
    },
};

export const PINE_LANGUAGE_CONFIGURATION = {
    comments: {
        lineComment: '//',
    },
    brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')'],
    ],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
    surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
};

/**
 * Registers Pine Script v5/v6 syntax into a Monaco Editor runtime.
 */
export function registerPineLanguage(monaco: MonacoRuntime | null | undefined): void {
    if (!monaco || !monaco.languages) return;

    const langs = monaco.languages.getLanguages();
    if (!langs.some((l) => l.id === PINE_LANGUAGE_ID)) {
        monaco.languages.register({ id: PINE_LANGUAGE_ID, extensions: ['.pine', '.ps'] });
        monaco.languages.setMonarchTokensProvider(PINE_LANGUAGE_ID, PINE_MONARCH_TOKENS_PROVIDER);
        monaco.languages.setLanguageConfiguration(PINE_LANGUAGE_ID, PINE_LANGUAGE_CONFIGURATION);
    }
}

/**
 * Pine Script IDE with Monaco Editor integration, syntax highlighting,
 * error squiggles, and action controls ("Save", "Add to Chart", "Update Strategy").
 */
export class MonacoPineEditor {
    private container: HTMLElement | null = null;
    private rootElement: HTMLElement | null = null;
    private editorHostElement: HTMLElement | null = null;
    private toolbarElement: HTMLElement | null = null;
    private diagnosticsBarElement: HTMLElement | null = null;
    private fallbackTextarea: HTMLTextAreaElement | null = null;

    private monacoInstance: MonacoRuntime | null = null;
    private editorInstance: MonacoEditorInstance | null = null;
    private code: string;
    private diagnostics: EditorDiagnostic[] = [];
    private actionListeners = new Set<EditorActionCallback>();

    constructor(options: MonacoPineEditorOptions = {}) {
        this.code = options.initialCode ?? '//@version=5\nstrategy("My Pine Strategy", overlay=true)\n\nfast = ta.sma(close, 14)\nslow = ta.sma(close, 28)\n\nif ta.crossover(fast, slow)\n    strategy.entry("Long", strategy.long)\n\nif ta.crossunder(fast, slow)\n    strategy.close("Long")\n';
        if (options.monaco) {
            this.monacoInstance = options.monaco;
        } else if (typeof window !== 'undefined' && 'monaco' in window) {
            const globalMonaco = (window as unknown as { monaco?: MonacoRuntime }).monaco;
            this.monacoInstance = globalMonaco ?? null;
        }
    }

    mount(container: HTMLElement): void {
        this.container = container;
        this.buildDOM();
        this.initEditor();
    }

    destroy(): void {
        if (this.editorInstance) {
            try {
                this.editorInstance.dispose();
            } catch {
                // dispose
            }
            this.editorInstance = null;
        }
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
        this.rootElement = null;
        this.editorHostElement = null;
        this.toolbarElement = null;
        this.diagnosticsBarElement = null;
        this.fallbackTextarea = null;
        this.container = null;
        this.actionListeners.clear();
    }

    getValue(): string {
        if (this.editorInstance) {
            return this.editorInstance.getValue();
        }
        if (this.fallbackTextarea) {
            return this.fallbackTextarea.value;
        }
        return this.code;
    }

    getCode(): string {
        return this.getValue();
    }

    setValue(code: string): void {
        this.code = code;
        if (this.editorInstance) {
            this.editorInstance.setValue(code);
        }
        if (this.fallbackTextarea) {
            this.fallbackTextarea.value = code;
        }
    }

    setCode(code: string): void {
        this.setValue(code);
    }

    setDiagnostics(diagnostics: EditorDiagnostic[]): void {
        this.diagnostics = diagnostics;

        // Hook parser diagnostics to Monaco marker squiggles
        if (this.monacoInstance && this.editorInstance) {
            const model = this.editorInstance.getModel();
            if (model) {
                const markers: MonacoMarker[] = diagnostics.map((d) => ({
                    severity:
                        d.severity === 'error'
                            ? this.monacoInstance!.MarkerSeverity.Error
                            : d.severity === 'warning'
                            ? this.monacoInstance!.MarkerSeverity.Warning
                            : this.monacoInstance!.MarkerSeverity.Info,
                    startLineNumber: d.line,
                    startColumn: d.column,
                    endLineNumber: d.endLine ?? d.line,
                    endColumn: d.endColumn ?? d.column + 5,
                    message: d.message,
                }));
                this.monacoInstance.editor.setModelMarkers(model, 'pineorca', markers);
            }
        }

        this.renderDiagnosticsBar();
    }

    getDiagnostics(): readonly EditorDiagnostic[] {
        return this.diagnostics;
    }

    onAction(cb: EditorActionCallback): () => void {
        this.actionListeners.add(cb);
        return () => this.actionListeners.delete(cb);
    }

    triggerAction(action: EditorAction): void {
        const currentCode = this.getValue();
        for (const listener of this.actionListeners) {
            listener(action, currentCode);
        }
    }

    getElement(): HTMLElement | null {
        return this.rootElement;
    }

    getEditorInstance(): MonacoEditorInstance | null {
        return this.editorInstance;
    }

    private buildDOM(): void {
        if (typeof document === 'undefined' || !this.container) return;

        const root = document.createElement('div');
        root.className = 'pineorca-pine-editor';
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.backgroundColor = '#1e222d';
        root.style.color = '#d1d4dc';
        root.style.overflow = 'hidden';
        root.style.boxSizing = 'border-box';
        this.rootElement = root;

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'pineorca-editor-toolbar';
        toolbar.style.display = 'flex';
        toolbar.style.alignItems = 'center';
        toolbar.style.justifyContent = 'space-between';
        toolbar.style.padding = '6px 12px';
        toolbar.style.backgroundColor = '#181b24';
        toolbar.style.borderBottom = '1px solid #2a2e39';
        this.toolbarElement = toolbar;

        const title = document.createElement('div');
        title.style.display = 'flex';
        title.style.alignItems = 'center';
        title.style.gap = '8px';
        title.innerHTML = `
            <span style="color: #2962ff; font-weight: 700; font-size: 13px;">Pine Script® IDE</span>
            <span style="color: #787b86; font-size: 11px;">v5/v6 Compatible</span>
        `;
        toolbar.appendChild(title);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.alignItems = 'center';
        actions.style.gap = '6px';

        const createButton = (label: string, bg: string, color: string, action: EditorAction, shortcut?: string) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.title = shortcut ? `${label} (${shortcut})` : label;
            btn.style.backgroundColor = bg;
            btn.style.color = color;
            btn.style.border = 'none';
            btn.style.borderRadius = '4px';
            btn.style.padding = '4px 10px';
            btn.style.fontSize = '12px';
            btn.style.fontWeight = '600';
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', () => this.triggerAction(action));
            return btn;
        };

        actions.appendChild(createButton('Save', '#2a2e39', '#d1d4dc', 'save', 'Ctrl+S'));
        actions.appendChild(createButton('Add to Chart', '#2a2e39', '#2962ff', 'addToChart'));
        actions.appendChild(createButton('Update Strategy', '#2962ff', '#ffffff', 'updateStrategy', 'Ctrl+Enter'));

        toolbar.appendChild(actions);
        root.appendChild(toolbar);

        // Editor host
        const editorHost = document.createElement('div');
        editorHost.className = 'pineorca-editor-host';
        editorHost.style.flex = '1';
        editorHost.style.position = 'relative';
        editorHost.style.overflow = 'hidden';
        this.editorHostElement = editorHost;
        root.appendChild(editorHost);

        // Diagnostics status bar
        const diagBar = document.createElement('div');
        diagBar.className = 'pineorca-editor-diagnostics';
        diagBar.style.display = 'none';
        diagBar.style.padding = '4px 12px';
        diagBar.style.backgroundColor = '#181b24';
        diagBar.style.borderTop = '1px solid #2a2e39';
        diagBar.style.fontSize = '11px';
        diagBar.style.color = '#f23645';
        diagBar.style.maxHeight = '60px';
        diagBar.style.overflowY = 'auto';
        this.diagnosticsBarElement = diagBar;
        root.appendChild(diagBar);

        // Keydown shortcuts on root
        root.addEventListener('keydown', (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.triggerAction('updateStrategy');
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.triggerAction('save');
            }
        });

        this.container.appendChild(root);
    }

    private initEditor(): void {
        if (!this.editorHostElement) return;

        if (this.monacoInstance) {
            registerPineLanguage(this.monacoInstance);

            this.editorInstance = this.monacoInstance.editor.create(this.editorHostElement, {
                value: this.code,
                language: PINE_LANGUAGE_ID,
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: 13,
                fontFamily: 'JetBrains Mono, Fira Code, Menlo, Monaco, Courier New, monospace',
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                tabSize: 4,
                insertSpaces: true,
            });

            // Bind Monaco keybinding Ctrl+Enter
            if (this.monacoInstance.KeyMod && this.monacoInstance.KeyCode) {
                this.editorInstance.addCommand(
                    this.monacoInstance.KeyMod.CtrlCmd | this.monacoInstance.KeyCode.Enter,
                    () => this.triggerAction('updateStrategy')
                );
                this.editorInstance.addCommand(
                    this.monacoInstance.KeyMod.CtrlCmd | this.monacoInstance.KeyCode.KeyS,
                    () => this.triggerAction('save')
                );
            }
        } else {
            // High-fidelity fallback editor with styled code textarea
            const textarea = document.createElement('textarea');
            textarea.className = 'pineorca-editor-fallback';
            textarea.value = this.code;
            textarea.style.width = '100%';
            textarea.style.height = '100%';
            textarea.style.backgroundColor = '#131722';
            textarea.style.color = '#d1d4dc';
            textarea.style.fontFamily = 'JetBrains Mono, Fira Code, Menlo, Monaco, monospace';
            textarea.style.fontSize = '13px';
            textarea.style.lineHeight = '1.5';
            textarea.style.border = 'none';
            textarea.style.outline = 'none';
            textarea.style.padding = '8px 12px';
            textarea.style.boxSizing = 'border-box';
            textarea.style.resize = 'none';
            textarea.style.whiteSpace = 'pre';
            textarea.style.tabSize = '4';

            textarea.addEventListener('input', () => {
                this.code = textarea.value;
            });

            this.fallbackTextarea = textarea;
            this.editorHostElement.appendChild(textarea);
        }
    }

    private renderDiagnosticsBar(): void {
        if (!this.diagnosticsBarElement) return;

        if (this.diagnostics.length === 0) {
            this.diagnosticsBarElement.style.display = 'none';
            this.diagnosticsBarElement.innerHTML = '';
            return;
        }

        this.diagnosticsBarElement.style.display = 'block';
        const errors = this.diagnostics.filter((d) => d.severity === 'error');
        const warnings = this.diagnostics.filter((d) => d.severity === 'warning');
        const escapeHtml = (str: string) =>
            str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        let html = `<div style="font-weight: 600; margin-bottom: 2px;">Diagnostics: ${errors.length} Error(s), ${warnings.length} Warning(s)</div>`;
        for (const d of this.diagnostics) {
            const color = d.severity === 'error' ? '#f23645' : d.severity === 'warning' ? '#ff9800' : '#2962ff';
            html += `<div style="color: ${color};">Line ${d.line}, Col ${d.column}: ${escapeHtml(d.message)}</div>`;
        }
        this.diagnosticsBarElement.innerHTML = html;
    }
}
