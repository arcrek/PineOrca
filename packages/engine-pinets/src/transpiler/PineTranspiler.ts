// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 PineOrca Authors

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { transpile } from './index';
import { extractPineScriptVersion, pineToJS } from './pineToJS/pineToJS.index';
import { ScopeManager } from './ScopeManager';

export interface SecurityRequestDescriptor {
  id: string;
  symbol: string;
  timeframe: string;
  expression: string;
  gaps?: string;
  lookahead?: string;
}

export interface PineScriptMetadata {
  version: number | null;
  isStrategy: boolean;
  title?: string;
  overlay?: boolean;
  securityRequests: SecurityRequestDescriptor[];
}

export interface TranspileOptions {
  debug?: boolean;
  ln?: boolean;
  sync?: boolean;
  preResolveSecurity?: boolean;
}

export interface CompiledPineScript {
  fn: Function;
  isSync: boolean;
  version: number | null;
  securityRequests: SecurityRequestDescriptor[];
  metadata: PineScriptMetadata;
  transformedCode?: string;
}

/**
 * High-performance Pine Script v5/v6 Transpiler.
 * Transforms Pine Script AST into optimized, synchronous or asynchronous JavaScript execution kernels.
 */
export class PineTranspiler {
  /**
   * Scans Pine Script source for external `request.security` requests before execution.
   */
  public static scanSecurityRequests(source: string): SecurityRequestDescriptor[] {
    const descriptors: SecurityRequestDescriptor[] = [];
    if (!source.includes('request.security')) {
      return descriptors;
    }

    // Convert to JS representation to inspect AST
    let jsCode = source;
    const ver = extractPineScriptVersion(source);
    if (ver !== null && ver >= 5) {
      const res = pineToJS(source);
      if (res.success) {
        jsCode = res.code;
      }
    }

    try {
      const ast = acorn.parse(jsCode, {
        ecmaVersion: 'latest',
        sourceType: 'module',
      });

      let count = 0;
      const baseVisitor = { ...walk.base, LineComment: () => {} };

      walk.simple(
        ast,
        {
          CallExpression(node: any) {
            const callee = node.callee;
            const isSecCall =
              callee &&
              callee.type === 'MemberExpression' &&
              callee.object?.name === 'request' &&
              (callee.property?.name === 'security' || callee.property?.name === 'security_lower_tf');

            if (isSecCall && node.arguments.length >= 3) {
              const id = `__sec_${count++}`;
              const arg0 = node.arguments[0];
              const arg1 = node.arguments[1];
              const arg2 = node.arguments[2];

              const symbol =
                arg0.type === 'Literal'
                  ? String(arg0.value)
                  : arg0.name || 'syminfo.tickerid';
              const timeframe =
                arg1.type === 'Literal'
                  ? String(arg1.value)
                  : arg1.name || '';
              const expression =
                arg2.type === 'Literal'
                  ? String(arg2.value)
                  : arg2.name || 'close';

              descriptors.push({
                id,
                symbol,
                timeframe,
                expression,
              });
            }
          },
        },
        baseVisitor,
      );
    } catch {
      // Fallback regex scan for security calls if AST parsing hits dialect quirks
      const regex = /request\.security(?:_lower_tf)?\s*\(\s*([^,\)]+)\s*,\s*([^,\)]+)\s*,\s*([^,\)]+)/g;
      let match: RegExpExecArray | null;
      let count = 0;
      while ((match = regex.exec(source)) !== null) {
        descriptors.push({
          id: `__sec_${count++}`,
          symbol: match[1].replace(/['"]/g, '').trim(),
          timeframe: match[2].replace(/['"]/g, '').trim(),
          expression: match[3].trim(),
        });
      }
    }

    return descriptors;
  }

  /**
   * Inspects top-level Pine Script declaration to extract metadata.
   */
  public static scanMetadata(source: string): PineScriptMetadata {
    const version = extractPineScriptVersion(source);
    const isStrategy = /\bstrategy\s*\(/.test(source);
    const securityRequests = this.scanSecurityRequests(source);

    const titleMatch = source.match(/(?:indicator|strategy)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/);
    const overlayMatch = source.match(/overlay\s*=\s*(true|false)/);

    return {
      version,
      isStrategy,
      title: titleMatch ? titleMatch[1] : undefined,
      overlay: overlayMatch ? overlayMatch[1] === 'true' : false,
      securityRequests,
    };
  }

  /**
   * Transpiles Pine Script or PineTS source into an executable JS function.
   * If `sync: true` or `preResolveSecurity: true` (and all security calls are pre-resolved),
   * compiles directly into a synchronous execution function.
   */
  public static transpile(
    source: string | Function,
    options: TranspileOptions = {},
  ): CompiledPineScript {
    const sourceStr = typeof source === 'function' ? source.toString() : source;
    const metadata = this.scanMetadata(sourceStr);

    const hasSecurity = metadata.securityRequests.length > 0;
    // Default to synchronous execution if there are no security calls or if preResolveSecurity is requested
    const shouldBeSync = options.sync ?? (options.preResolveSecurity ? true : !hasSecurity);

    const fn = transpile(source, {
      debug: options.debug ?? false,
      ln: options.ln ?? false,
      sync: shouldBeSync,
    } as any);

    return {
      fn,
      isSync: shouldBeSync,
      version: metadata.version,
      securityRequests: metadata.securityRequests,
      metadata,
    };
  }
}

export default PineTranspiler;
