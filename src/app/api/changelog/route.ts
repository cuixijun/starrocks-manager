import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export interface ChangelogSection {
  title: string;           // h2 heading
  content: string;         // raw markdown under the h2
}

export interface ChangelogEntry {
  id: string;              // slug from filename
  title: string;           // h1 heading
  date: string;            // 日期 field
  branch: string;          // 分支 field
  commits?: string;        // 提交 field (optional)
  sections: ChangelogSection[];
  filename: string;
}

function parseChangelog(content: string, filename: string): ChangelogEntry {
  const lines = content.split('\n');
  const id = filename.replace(/\.md$/, '');

  // Extract h1 title
  const h1Line = lines.find(l => l.startsWith('# '));
  const title = h1Line ? h1Line.replace(/^#\s+/, '').trim() : filename;

  // Extract metadata from blockquote lines
  let date = '';
  let branch = '';
  let commits = '';
  for (const line of lines) {
    const trimmed = line.replace(/^>\s*/, '').trim();
    if (trimmed.startsWith('日期')) {
      date = trimmed.replace(/^日期[：:]\s*/, '').trim();
    } else if (trimmed.startsWith('分支')) {
      branch = trimmed.replace(/^分支[：:]\s*/, '').replace(/`/g, '').trim();
    } else if (trimmed.startsWith('提交')) {
      commits = trimmed.replace(/^提交[：:]\s*/, '').replace(/`/g, '').trim();
    }
  }

  // Split into h2 sections
  const sections: ChangelogSection[] = [];
  let currentSection: ChangelogSection | null = null;
  let contentLines: string[] = [];
  let pastMeta = false;

  for (const line of lines) {
    // Skip h1 and blockquote metadata
    if (line.startsWith('# ') && !line.startsWith('## ')) continue;
    if (line.startsWith('>') && !pastMeta) continue;
    if (!pastMeta && line.trim() === '') continue;

    pastMeta = true;

    if (line.startsWith('## ')) {
      // Save previous section
      if (currentSection) {
        currentSection.content = contentLines.join('\n').trim();
        sections.push(currentSection);
      }
      currentSection = { title: line.replace(/^##\s+/, '').trim(), content: '' };
      contentLines = [];
    } else {
      contentLines.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    currentSection.content = contentLines.join('\n').trim();
    sections.push(currentSection);
  }

  return { id, title, date, branch, commits, sections, filename };
}

export async function GET() {
  try {
    const changelogDir = path.join(process.cwd(), 'docs', 'changelog');

    if (!fs.existsSync(changelogDir)) {
      return NextResponse.json([]);
    }

    const files = fs.readdirSync(changelogDir).filter(f => f.endsWith('.md'));
    const entries: ChangelogEntry[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(changelogDir, file), 'utf-8');
      const entry = parseChangelog(content, file);
      // Extract numeric prefix for sorting (e.g. "005_db-migrations.md" → 5)
      const match = file.match(/^(\d+)_/);
      (entry as ChangelogEntry & { _order: number })._order = match ? parseInt(match[1], 10) : 0;
      entries.push(entry);
    }

    // Sort by numeric prefix descending (newest first)
    entries.sort((a, b) => {
      const oa = (a as ChangelogEntry & { _order: number })._order || 0;
      const ob = (b as ChangelogEntry & { _order: number })._order || 0;
      return ob - oa;
    });

    return NextResponse.json(entries);
  } catch (error) {
    console.error('Failed to read changelog:', error);
    return NextResponse.json({ error: 'Failed to read changelog' }, { status: 500 });
  }
}
