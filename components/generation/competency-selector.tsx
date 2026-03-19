'use client';

import { useState, useMemo, useCallback } from 'react';
import { Search, X, ChevronDown, BookOpen, GraduationCap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import competencyData from '@/lib/data/nmc-competencies-2024.json';

const MAX_COMPETENCIES = 8;

interface Subject {
  code: string;
  name: string;
  topics: Topic[];
}

interface Topic {
  name: string;
  competencies: Competency[];
}

interface Competency {
  code: string;
  text: string;
  domain: string;
  level: string;
  isCore: boolean;
  teachingMethods: string;
  assessmentMethods: string;
}

interface CompetencySelectorProps {
  selectedCodes: string[];
  onChange: (codes: string[]) => void;
}

export function CompetencySelector({ selectedCodes, onChange }: CompetencySelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedTopic, setSelectedTopic] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const subjects = competencyData.subjects as Subject[];

  // Build a flat lookup for displaying selected competency info
  const competencyLookup = useMemo(() => {
    const map = new Map<string, { code: string; text: string; subjectCode: string }>();
    for (const subject of subjects) {
      for (const topic of subject.topics) {
        for (const comp of topic.competencies) {
          map.set(comp.code, {
            code: comp.code,
            text: comp.text,
            subjectCode: subject.code,
          });
        }
      }
    }
    return map;
  }, [subjects]);

  // Current subject & topic objects
  const currentSubject = subjects.find((s) => s.code === selectedSubject);
  const currentTopics = currentSubject?.topics ?? [];
  const currentTopic = currentTopics.find((t) => t.name === selectedTopic);

  // Search results (flat list across all subjects/topics)
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results: (Competency & { subjectCode: string; topicName: string })[] = [];
    for (const subject of subjects) {
      for (const topic of subject.topics) {
        for (const comp of topic.competencies) {
          if (
            comp.code.toLowerCase().includes(q) ||
            comp.text.toLowerCase().includes(q)
          ) {
            results.push({ ...comp, subjectCode: subject.code, topicName: topic.name });
          }
          if (results.length >= 50) break;
        }
        if (results.length >= 50) break;
      }
      if (results.length >= 50) break;
    }
    return results;
  }, [searchQuery, subjects]);

  const isAtLimit = selectedCodes.length >= MAX_COMPETENCIES;

  const toggleCompetency = useCallback(
    (code: string) => {
      if (selectedCodes.includes(code)) {
        onChange(selectedCodes.filter((c) => c !== code));
      } else if (!isAtLimit) {
        onChange([...selectedCodes, code]);
      }
    },
    [selectedCodes, onChange, isAtLimit],
  );

  const removeCompetency = useCallback(
    (code: string) => {
      onChange(selectedCodes.filter((c) => c !== code));
    },
    [selectedCodes, onChange],
  );

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="w-full">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all text-xs',
          expanded
            ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
            : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40',
        )}
      >
        <GraduationCap className="size-3.5 shrink-0" />
        <span className="font-medium">NMC Competencies</span>
        {selectedCodes.length > 0 && (
          <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1.5">
            {selectedCodes.length}/{MAX_COMPETENCIES}
          </Badge>
        )}
        <ChevronDown
          className={cn(
            'size-3 ml-auto transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {/* Selected badges (always visible when there are selections) */}
      {selectedCodes.length > 0 && !expanded && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {selectedCodes.map((code) => {
            const info = competencyLookup.get(code);
            return (
              <Badge
                key={code}
                variant="outline"
                className="h-5 gap-1 text-[10px] font-mono pr-1 cursor-pointer hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors"
                onClick={() => removeCompetency(code)}
              >
                {code}
                <X className="size-2.5" />
              </Badge>
            );
          })}
        </div>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-2 rounded-xl border border-border/60 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border/40">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
              <Input
                placeholder="Search by code or text (e.g. AN79.1 or 'neurulation')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs bg-transparent border-border/40"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          {isSearching ? (
            /* Search results */
            <ScrollArea className="max-h-[280px] overflow-y-auto">
              <div className="p-2 space-y-0.5">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50 text-center py-6">
                    No competencies found
                  </p>
                ) : (
                  searchResults.map((comp) => {
                    const isSelected = selectedCodes.includes(comp.code);
                    const isDisabled = isAtLimit && !isSelected;
                    return (
                      <CompetencyRow
                        key={comp.code}
                        code={comp.code}
                        text={comp.text}
                        isCore={comp.isCore}
                        domain={comp.domain}
                        isSelected={isSelected}
                        isDisabled={isDisabled}
                        onToggle={() => toggleCompetency(comp.code)}
                        prefix={comp.subjectCode}
                      />
                    );
                  })
                )}
              </div>
            </ScrollArea>
          ) : (
            /* Browse mode: Subject → Topic → Competencies */
            <div className="flex min-h-[200px] max-h-[320px]">
              {/* Subject column */}
              <div className="w-[140px] shrink-0 border-r border-border/40 overflow-y-auto">
                <div className="p-1">
                  {subjects.map((subject) => (
                    <button
                      key={subject.code}
                      type="button"
                      onClick={() => {
                        setSelectedSubject(subject.code);
                        setSelectedTopic('');
                      }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors',
                        selectedSubject === subject.code
                          ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <span className="font-mono text-[10px] opacity-60">{subject.code}</span>{' '}
                      <span className="truncate">{subject.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic + Competency area */}
              <div className="flex-1 flex flex-col min-w-0">
                {!selectedSubject ? (
                  <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/40">
                    <div className="text-center">
                      <BookOpen className="size-8 mx-auto mb-2 opacity-30" />
                      <p>Select a subject to browse</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Topic selector */}
                    <div className="p-2 border-b border-border/40">
                      <select
                        value={selectedTopic}
                        onChange={(e) => setSelectedTopic(e.target.value)}
                        className="w-full h-7 text-xs rounded-md border border-border/50 bg-transparent px-2 focus:outline-none focus:ring-1 focus:ring-violet-400/50"
                      >
                        <option value="">All topics ({currentTopics.length})</option>
                        {currentTopics.map((topic) => (
                          <option key={topic.name} value={topic.name}>
                            {topic.name} ({topic.competencies.length})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Competency list */}
                    <ScrollArea className="flex-1 overflow-y-auto">
                      <div className="p-2 space-y-0.5">
                        {(selectedTopic && currentTopic
                          ? currentTopic.competencies
                          : currentTopics.flatMap((t) => t.competencies)
                        ).map((comp) => {
                          const isSelected = selectedCodes.includes(comp.code);
                          const isDisabled = isAtLimit && !isSelected;
                          return (
                            <CompetencyRow
                              key={comp.code}
                              code={comp.code}
                              text={comp.text}
                              isCore={comp.isCore}
                              domain={comp.domain}
                              isSelected={isSelected}
                              isDisabled={isDisabled}
                              onToggle={() => toggleCompetency(comp.code)}
                            />
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Footer: selected badges */}
          {selectedCodes.length > 0 && (
            <div className="border-t border-border/40 p-2">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-medium text-muted-foreground/60">
                  Selected ({selectedCodes.length}/{MAX_COMPETENCIES})
                </span>
                {isAtLimit && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400">
                    — limit reached
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedCodes.map((code) => (
                  <Badge
                    key={code}
                    variant="outline"
                    className="h-5 gap-1 text-[10px] font-mono pr-1 cursor-pointer hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors"
                    onClick={() => removeCompetency(code)}
                  >
                    {code}
                    <X className="size-2.5" />
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Competency row item ─────────────────────────────────────────
function CompetencyRow({
  code,
  text,
  isCore,
  domain,
  isSelected,
  isDisabled,
  onToggle,
  prefix,
}: {
  code: string;
  text: string;
  isCore: boolean;
  domain: string;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: () => void;
  prefix?: string;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
        isSelected
          ? 'bg-violet-50 dark:bg-violet-950/20'
          : 'hover:bg-muted/40',
        isDisabled && !isSelected && 'opacity-40 cursor-not-allowed',
      )}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={() => {
          if (!isDisabled || isSelected) onToggle();
        }}
        disabled={isDisabled && !isSelected}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] font-semibold text-violet-600 dark:text-violet-400">
            {prefix ? `${prefix}/` : ''}
            {code}
          </span>
          {isCore && (
            <span className="text-[9px] font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1 rounded">
              Core
            </span>
          )}
          <span className="text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1 rounded">
            {domain}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
          {text}
        </p>
      </div>
    </label>
  );
}
