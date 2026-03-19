'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Subject-based color mapping for competency code badges.
 * Extracts the subject prefix from the code (e.g., "AN" from "AN79.1").
 */
const SUBJECT_COLORS: Record<string, string> = {
  AN: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  BI: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  PY: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  PA: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  MI: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  PH: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  FM: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  CM: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  IM: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  SU: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  OG: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  PE: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  OR: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  EN: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  OP: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  PS: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
  DR: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-300',
  RD: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  AS: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
};

const DEFAULT_COLOR = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';

function getSubjectPrefix(code: string): string {
  const match = code.match(/^([A-Z]{2})/);
  return match ? match[1] : '';
}

interface CompetencyBadgesProps {
  codes: string[];
  className?: string;
}

/**
 * Displays competency codes as small colored pills.
 * Subject prefix determines the badge color.
 */
export function CompetencyBadges({ codes, className }: CompetencyBadgesProps) {
  if (codes.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {codes.map((code) => {
        const prefix = getSubjectPrefix(code);
        const colorClass = SUBJECT_COLORS[prefix] || DEFAULT_COLOR;
        return (
          <Badge
            key={code}
            variant="outline"
            className={cn(
              'h-4 px-1.5 text-[9px] font-mono font-semibold border-0 rounded-sm',
              colorClass,
            )}
          >
            {code}
          </Badge>
        );
      })}
    </div>
  );
}
