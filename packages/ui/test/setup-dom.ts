// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 PineOrca Authors

export class MockDOMRect {
    constructor(
        public x = 0,
        public y = 0,
        public width = 800,
        public height = 400,
        public top = 0,
        public right = 800,
        public bottom = 400,
        public left = 0
    ) {}
}

export type EventListener = (evt: unknown) => void;

export class MockHTMLElement {
    public tagName: string;
    public className = '';
    public id = '';
    public innerHTML = '';
    public textContent = '';
    public value = '';
    public title = '';
    public colSpan = 1;
    public parentNode: MockHTMLElement | null = null;
    public children: MockHTMLElement[] = [];
    public style: Record<string, string> = {};
    public attributes: Record<string, string> = {};
    public scrollTop = 0;
    public scrollHeight = 0;
    public clientHeight = 400;
    public clientWidth = 800;

    private listeners = new Map<string, Set<EventListener>>();

    constructor(tagName: string) {
        this.tagName = tagName.toUpperCase();
    }

    appendChild<T extends MockHTMLElement>(child: T): T {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild<T extends MockHTMLElement>(child: T): T {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    setAttribute(name: string, val: string): void {
        this.attributes[name] = val;
    }

    getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
    }

    removeAttribute(name: string): void {
        delete this.attributes[name];
    }

    getBoundingClientRect(): MockDOMRect {
        return new MockDOMRect(0, 0, this.clientWidth, this.clientHeight);
    }

    addEventListener(type: string, listener: EventListener): void {
        let set = this.listeners.get(type);
        if (!set) {
            set = new Set();
            this.listeners.set(type, set);
        }
        set.add(listener);
    }

    removeEventListener(type: string, listener: EventListener): void {
        const set = this.listeners.get(type);
        if (set) {
            set.delete(listener);
        }
    }

    dispatchEvent(event: { type: string; [key: string]: unknown }): boolean {
        const set = this.listeners.get(event.type);
        if (set) {
            for (const listener of set) {
                listener(event);
            }
        }
        return true;
    }

    get firstChild(): MockHTMLElement | null {
        return this.children[0] ?? null;
    }

    get lastChild(): MockHTMLElement | null {
        return this.children[this.children.length - 1] ?? null;
    }

    get parentElement(): MockHTMLElement | null {
        return this.parentNode;
    }

    click(): void {
        this.dispatchEvent({ type: 'click' });
    }
}

export class MockCanvasGradient {
    addColorStop(_offset: number, _color: string): void {}
}

export class MockCanvasContext2D {
    public strokeStyle = '#000000';
    public fillStyle = '#000000';
    public lineWidth = 1;
    public font = '10px sans-serif';
    public textAlign = 'left';

    clearRect(_x: number, _y: number, _w: number, _h: number): void {}
    beginPath(): void {}
    closePath(): void {}
    moveTo(_x: number, _y: number): void {}
    lineTo(_x: number, _y: number): void {}
    stroke(): void {}
    fill(): void {}
    arc(_x: number, _y: number, _r: number, _sAngle: number, _eAngle: number): void {}
    save(): void {}
    restore(): void {}
    scale(_x: number, _y: number): void {}
    setLineDash(_segments: number[]): void {}
    fillText(_text: string, _x: number, _y: number): void {}
    createLinearGradient(_x0: number, _y0: number, _x1: number, _y1: number): MockCanvasGradient {
        return new MockCanvasGradient();
    }
}

export class MockHTMLCanvasElement extends MockHTMLElement {
    public width = 800;
    public height = 400;
    private ctx = new MockCanvasContext2D();

    constructor() {
        super('CANVAS');
    }

    getContext(type: string): MockCanvasContext2D | null {
        if (type === '2d') {
            return this.ctx;
        }
        return null;
    }
}

export class MockResizeObserver {
    private callback: (entries: Array<{ contentRect: MockDOMRect }>) => void;

    constructor(cb: (entries: Array<{ contentRect: MockDOMRect }>) => void) {
        this.callback = cb;
    }

    observe(target: MockHTMLElement): void {
        this.callback([{ contentRect: target.getBoundingClientRect() }]);
    }

    unobserve(_target: MockHTMLElement): void {}
    disconnect(): void {}
}

export function setupTestDOM(): {
    cleanup: () => void;
    container: MockHTMLElement;
} {
    const env = globalThis as unknown as Record<string, unknown>;
    const originalDocument = env.document;
    const originalWindow = env.window;
    const originalResizeObserver = env.ResizeObserver;
    const originalRequestAnimationFrame = env.requestAnimationFrame;
    const originalCancelAnimationFrame = env.cancelAnimationFrame;

    const body = new MockHTMLElement('BODY');
    const container = new MockHTMLElement('DIV');
    body.appendChild(container);

    const doc = {
        body,
        createElement(tagName: string): MockHTMLElement {
            if (tagName.toLowerCase() === 'canvas') {
                return new MockHTMLCanvasElement();
            }
            return new MockHTMLElement(tagName);
        },
    };

    const listeners = new Map<string, Set<EventListener>>();
    const win = {
        devicePixelRatio: 1,
        addEventListener(type: string, listener: EventListener) {
            let set = listeners.get(type);
            if (!set) {
                set = new Set();
                listeners.set(type, set);
            }
            set.add(listener);
        },
        removeEventListener(type: string, listener: EventListener) {
            const set = listeners.get(type);
            if (set) {
                set.delete(listener);
            }
        },
        dispatchEvent(event: { type: string }) {
            const set = listeners.get(event.type);
            if (set) {
                for (const l of set) l(event);
            }
        },
    };

    env.document = doc;
    env.window = win;
    env.HTMLElement = MockHTMLElement;
    env.HTMLCanvasElement = MockHTMLCanvasElement;
    env.ResizeObserver = MockResizeObserver;
    env.requestAnimationFrame = (cb: () => void) => {
        cb();
        return 1;
    };
    env.cancelAnimationFrame = () => {};

    const cleanup = () => {
        env.document = originalDocument;
        env.window = originalWindow;
        env.ResizeObserver = originalResizeObserver;
        env.requestAnimationFrame = originalRequestAnimationFrame;
        env.cancelAnimationFrame = originalCancelAnimationFrame;
    };

    return { cleanup, container };
}
