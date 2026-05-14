/**
 * Result Extraction Capability Implementation
 *
 * Wraps the existing extractStructuredResult / stripResultBlocks functions
 * into the capability interface.
 */

import { extractStructuredResult } from '@/lib/ai/result-channel';
import type { ResultExtractionCapability } from './types';

export function createResultExtractionCapability(): ResultExtractionCapability {
  return {
    extract<T>(text: string, predicate: (v: any) => v is T): T | null {
      return extractStructuredResult(text, predicate);
    },
    strip(text: string): string {
      return String(text || '').replace(/<result>[\s\S]*?(?:<\/result>|$)/gi, '').trim();
    },
  };
}
