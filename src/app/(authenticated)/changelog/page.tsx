'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader } from '@/components/ui';
import {
  ScrollText,
  Calendar,
  GitBranch,
  ChevronDown,
  ChevronRight,
  FileText,
  Sparkles,
  Wrench,
  Bug,
  ListChecks,
  BookOpen,
  Trash2,
  TestTube,
  Search,
} from 'lucide-react';

interface ChangelogSection {
  title: string;
  content: string;
}

interface ChangelogEntry {
  id: string;
  title: string;
  date: string;
  branch: string;
  commits?: string;
  sections: ChangelogSection[];
  filename: string;
}

/* ── Semantic colors by change type ── */
const TYPE_COLORS = {
  feature:        { bg: 'rgba(59, 130, 246, 0.06)', border: 'rgba(59, 130, 246, 0.2)',  dot: 'var(--primary-500)', accent: 'var(--primary-600)' },
  refactor:       { bg: 'rgba(139, 92, 246, 0.06)', border: 'rgba(139, 92, 246, 0.2)',  dot: 'var(--accent-500)',  accent: 'var(--accent-600)' },
  infrastructure: { bg: 'rgba(20, 184, 166, 0.06)', border: 'rgba(20, 184, 166, 0.2)',  dot: '#0d9488',            accent: '#0d9488' },
  fix:            { bg: 'rgba(234, 179, 8, 0.05)',  border: 'rgba(234, 179, 8, 0.2)',   dot: 'var(--warning-500)', accent: '#b45309' },
};

/** Detect dominant change type from section titles */
function detectChangeType(sections: { title: string }[]): keyof typeof TYPE_COLORS {
  const titles = sections.map(s => s.title.toLowerCase()).join(' ');
  // Count signals
  const hasFeature = titles.includes('新增') || titles.includes('功能');
  const hasRefactor = titles.includes('重构') || titles.includes('重写');
  const hasFix = titles.includes('修复') || titles.includes('bug');
  const hasInfra = titles.includes('迁移') || titles.includes('部署') || titles.includes('兼容');

  if (hasRefactor && !hasFeature) return 'refactor';
  if (hasFix && !hasFeature && !hasRefactor) return 'fix';
  if (hasInfra && !hasFeature) return 'infrastructure';
  return 'feature'; // default — most entries are feature-dominant
}

/* ── Section icon mapping ── */
function getSectionIcon(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes('新增') || lower.includes('功能')) return Sparkles;
  if (lower.includes('重构')) return Wrench;
  if (lower.includes('bug') || lower.includes('修复')) return Bug;
  if (lower.includes('变更文件') || lower.includes('清单')) return ListChecks;
  if (lower.includes('文档')) return BookOpen;
  if (lower.includes('清理') || lower.includes('删除')) return Trash2;
  if (lower.includes('测试') || lower.includes('统计')) return TestTube;
  return FileText;
}

/* ── Simple markdown renderer ── */
function MarkdownContent({ content }: { content: string }) {
  const html = renderMarkdown(content);
  return <div className="cl-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  let html = '';
  let inTable = false;
  let inList = false;
  let inCode = false;
  let codeContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trim().startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${escapeHtml(codeContent.trim())}</code></pre>`;
        codeContent = '';
        inCode = false;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeContent += line + '\n'; continue; }

    // Table rows
    if (line.trim().startsWith('|')) {
      if (line.trim().match(/^\|[\s-:|]+\|$/)) continue; // separator row
      const cells = line.split('|').filter(c => c.trim() !== '');
      if (!inTable) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<div class="cl-table-wrap"><table><thead><tr>';
        cells.forEach(c => { html += `<th>${inlineFormat(c.trim())}</th>`; });
        html += '</tr></thead><tbody>';
        inTable = true;
      } else {
        html += '<tr>';
        cells.forEach(c => { html += `<td>${inlineFormat(c.trim())}</td>`; });
        html += '</tr>';
      }
      continue;
    }
    if (inTable && !line.trim().startsWith('|')) {
      html += '</tbody></table></div>';
      inTable = false;
    }

    // h3 headings
    if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h4 class="cl-h3">${inlineFormat(line.replace(/^###\s+/, ''))}</h4>`;
      continue;
    }

    // list items
    if (line.trim().startsWith('- ')) {
      if (!inList) { html += '<ul class="cl-list">'; inList = true; }
      html += `<li>${inlineFormat(line.trim().replace(/^-\s+/, ''))}</li>`;
      continue;
    }

    // blockquote
    if (line.trim().startsWith('>')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<blockquote class="cl-quote">${inlineFormat(line.trim().replace(/^>\s*/, ''))}</blockquote>`;
      continue;
    }

    // empty line
    if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }

    // paragraph
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${inlineFormat(line)}</p>`;
  }

  if (inList) html += '</ul>';
  if (inTable) html += '</tbody></table></div>';
  if (inCode) html += `<pre><code>${escapeHtml(codeContent.trim())}</code></pre>`;

  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFormat(s: string): string {
  // bold
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // inline code
  s = s.replace(/`([^`]+)`/g, '<code class="cl-inline-code">$1</code>');
  // checkmarks
  s = s.replace(/✅/g, '<span class="cl-check">✅</span>');
  return s;
}

export default function ChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    fetch('/starrocks-manager/api/changelog')
      .then(r => r.json())
      .then((data: ChangelogEntry[]) => {
        setEntries(data);
        const allIds = new Set(data.map(e => e.id));
        setExpandedEntries(allIds);
        if (data.length > 0) {
          const firstSections = new Set<string>();
          data.forEach(e => {
            if (e.sections.length > 0) {
              firstSections.add(`${e.id}:${e.sections[0].title}`);
            }
          });
          setExpandedSections(firstSections);
          setActiveId(data[0].id);
        }
      })
      .catch(() => setError('加载变更日志失败'))
      .finally(() => setLoading(false));
  }, []);

  // Filter entries by search term
  const filteredEntries = React.useMemo(() => {
    if (!searchTerm.trim()) return entries;
    const q = searchTerm.toLowerCase();
    return entries.filter(entry => {
      if (entry.title.toLowerCase().includes(q)) return true;
      if (entry.date.includes(q)) return true;
      if (entry.branch.toLowerCase().includes(q)) return true;
      return entry.sections.some(s =>
        s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
      );
    });
  }, [entries, searchTerm]);

  // When searching, auto-expand all matching entries & sections
  useEffect(() => {
    if (!searchTerm.trim()) return;
    const q = searchTerm.toLowerCase();
    const entryIds = new Set<string>();
    const sectionKeys = new Set<string>();
    filteredEntries.forEach(entry => {
      entryIds.add(entry.id);
      entry.sections.forEach(s => {
        if (s.title.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)) {
          sectionKeys.add(`${entry.id}:${s.title}`);
        }
      });
    });
    setExpandedEntries(entryIds);
    setExpandedSections(sectionKeys);
  }, [searchTerm, filteredEntries]);

  const toggleEntry = useCallback((id: string) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const scrollToEntry = useCallback((id: string) => {
    setActiveId(id);
    setExpandedEntries(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const node = nodeRefs.current[id];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Intersection observer for TOC highlight
  useEffect(() => {
    if (entries.length === 0) return;

    const observer = new IntersectionObserver(
      (ents) => {
        for (const e of ents) {
          if (e.isIntersecting) {
            setActiveId(e.target.getAttribute('data-entry-id') || '');
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 }
    );

    Object.values(nodeRefs.current).forEach(node => {
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [entries]);

  return (
    <>
      <PageHeader
        title="变更日志"
        breadcrumb={[{ label: '系统设置' }, { label: '变更日志' }]}
        description="系统功能迭代与变更记录"
      />
      <div className="page-body">
        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="loading-overlay"><div className="spinner" /> 加载中...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <ScrollText size={48} />
            <div className="empty-state-text">暂无变更日志</div>
          </div>
        ) : (
          <div className="cl-container fade-in">
            {/* ── Left TOC ── */}
            <aside className="cl-toc">
              <div className="cl-toc-header">
                <div className="cl-toc-title">
                  <ScrollText size={14} />
                  目录
                  <span className="cl-toc-count">{filteredEntries.length}/{entries.length}</span>
                </div>
                {/* Search input */}
                <div className="cl-search-wrap">
                  <Search size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  <input
                    className="cl-search-input"
                    type="text"
                    placeholder="搜索关键词..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                  {searchTerm && (
                    <button
                      className="cl-search-clear"
                      onClick={() => setSearchTerm('')}
                      title="清除搜索"
                    >×</button>
                  )}
                </div>
              </div>

              <div className="cl-toc-list">
                {filteredEntries.length === 0 ? (
                  <div className="cl-toc-empty">无匹配结果</div>
                ) : (
                  filteredEntries.map((entry) => {
                    const color = TYPE_COLORS[detectChangeType(entry.sections)];
                    return (
                      <button
                        key={entry.id}
                        className={`cl-toc-item ${activeId === entry.id ? 'active' : ''}`}
                        onClick={() => scrollToEntry(entry.id)}
                        style={{
                          borderLeftColor: activeId === entry.id ? color.dot : 'transparent',
                        }}
                      >
                        <div className="cl-toc-dot" style={{ background: color.dot }} />
                        <div className="cl-toc-info">
                          <div className="cl-toc-name">{entry.title}</div>
                          <div className="cl-toc-date">{entry.date}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            {/* ── Right Timeline ── */}
            <div className="cl-timeline">
              <div className="cl-timeline-line" />
              {filteredEntries.length === 0 ? (
                <div className="empty-state" style={{ paddingTop: 48 }}>
                  <Search size={48} />
                  <div className="empty-state-text">没有匹配「{searchTerm}」的变更记录</div>
                </div>
              ) : (
                filteredEntries.map((entry) => {
                  const color = TYPE_COLORS[detectChangeType(entry.sections)];
                  const isExpanded = expandedEntries.has(entry.id);

                  return (
                    <div
                      key={entry.id}
                      className="cl-node"
                      ref={el => { nodeRefs.current[entry.id] = el; }}
                      data-entry-id={entry.id}
                    >
                      {/* Timeline dot */}
                      <div className="cl-node-dot" style={{ background: color.dot, boxShadow: `0 0 0 4px ${color.bg}` }} />

                      {/* Content card */}
                      <div className="cl-node-card" style={{ borderColor: color.border }}>
                        {/* Header */}
                        <button
                          className="cl-node-header"
                          onClick={() => toggleEntry(entry.id)}
                          style={{ background: color.bg }}
                        >
                          <div className="cl-node-header-left">
                            {isExpanded
                              ? <ChevronDown size={16} style={{ color: color.accent, flexShrink: 0 }} />
                              : <ChevronRight size={16} style={{ color: color.accent, flexShrink: 0 }} />
                            }
                            <h3 style={{ color: color.accent }}>{entry.title}</h3>
                          </div>
                          <div className="cl-node-meta">
                            <span className="cl-meta-item">
                              <Calendar size={12} />
                              {entry.date}
                            </span>
                            {entry.branch && (
                              <span className="cl-meta-badge" style={{ background: color.border, color: color.accent }}>
                                <GitBranch size={11} />
                                {entry.branch}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Sections */}
                        {isExpanded && (
                          <div className="cl-node-body">
                            {entry.sections.map((section) => {
                              const sectionKey = `${entry.id}:${section.title}`;
                              const isSectionExpanded = expandedSections.has(sectionKey);
                              const SectionIcon = getSectionIcon(section.title);

                              return (
                                <div key={sectionKey} className="cl-section">
                                  <button
                                    className="cl-section-header"
                                    onClick={() => toggleSection(sectionKey)}
                                  >
                                    <div className="cl-section-header-left">
                                      {isSectionExpanded
                                        ? <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} />
                                        : <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
                                      }
                                      <SectionIcon size={14} style={{ color: color.accent }} />
                                      <span>{section.title}</span>
                                    </div>
                                  </button>
                                  {isSectionExpanded && (
                                    <div className="cl-section-body">
                                      <MarkdownContent content={section.content} />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}


