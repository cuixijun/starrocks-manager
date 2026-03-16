'use client';

import React, { useState, useMemo } from 'react';

// SQL keywords to highlight
const SQL_KEYWORDS = new Set([
  'CREATE', 'EXTERNAL', 'CATALOG', 'DROP', 'ALTER', 'TABLE', 'DATABASE',
  'PROPERTIES', 'COMMENT', 'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO',
  'VALUES', 'UPDATE', 'DELETE', 'SET', 'SHOW', 'GRANT', 'REVOKE', 'ON',
  'TO', 'ALL', 'IN', 'AS', 'IF', 'NOT', 'EXISTS', 'OR', 'AND', 'REPLACE',
  'WITH', 'LIKE', 'PARTITION', 'BY', 'ORDER', 'GROUP', 'HAVING', 'LIMIT',
  'OFFSET', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS',
  'UNION', 'EXCEPT', 'INTERSECT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'NULL', 'TRUE', 'FALSE', 'DEFAULT', 'PRIMARY', 'KEY', 'INDEX', 'UNIQUE',
  'CHECK', 'CONSTRAINT', 'FOREIGN', 'REFERENCES', 'CASCADE', 'RESTRICT',
  'ROLE', 'USER', 'USAGE', 'TABLES', 'DATABASES', 'SCHEMA',
  'MATERIALIZED', 'VIEW', 'REFRESH', 'ASYNC', 'EVERY', 'INTERVAL',
  'DISTRIBUTED', 'HASH', 'BUCKETS', 'AGGREGATE', 'DUPLICATE', 'RANGE',
  'SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'BETWEEN',
  'IS', 'OVER', 'ROWS', 'PRECEDING', 'FOLLOWING', 'UNBOUNDED', 'CURRENT',
  'ROW', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD',
  'COALESCE', 'IFNULL', 'NULLIF', 'CAST', 'CONVERT',
  'DATE', 'DATETIME', 'TIMESTAMP', 'INT', 'BIGINT', 'VARCHAR', 'CHAR',
  'DOUBLE', 'FLOAT', 'DECIMAL', 'BOOLEAN', 'TINYINT', 'SMALLINT',
  'ENGINE', 'USING', 'ENABLE', 'DISABLE', 'ACTIVE', 'INACTIVE',
  'ASC', 'DESC', 'TEMPORARY', 'FUNCTION', 'RETURNS', 'RETURN',
  'BEGIN', 'DECLARE', 'CALL', 'PROCEDURE', 'TRIGGER',
]);




interface SqlHighlighterProps {
  sql: string;
  style?: React.CSSProperties;
  showLineNumbers?: boolean;
  showFormatToggle?: boolean;
  maxHeight?: string;
  onCopy?: () => void;
  copied?: boolean;
}

export default function SqlHighlighter({
  sql,
  style,
  showLineNumbers = true,
  showFormatToggle = true,
  maxHeight = '600px',
  onCopy,
  copied = false,
}: SqlHighlighterProps) {
  const [formatted, setFormatted] = useState(true);

  const displaySql = useMemo(() => {
    return formatted ? formatSql(sql) : sql;
  }, [sql, formatted]);

  const lines = displaySql.split('\n');
  const tokens = useMemo(() => tokenize(displaySql), [displaySql]);

  // Build line→tokens mapping for line-by-line rendering
  const lineTokens = useMemo(() => {
    const result: Token[][] = [];
    let currentLine: Token[] = [];

    for (const token of tokens) {
      if (token.type === 'whitespace' && token.value.includes('\n')) {
        // Split whitespace token on newlines
        const parts = token.value.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            currentLine.push({ type: 'whitespace', value: parts[i] });
          }
          if (i < parts.length - 1) {
            result.push(currentLine);
            currentLine = [];
          }
        }
      } else {
        currentLine.push(token);
      }
    }
    if (currentLine.length > 0) result.push(currentLine);
    return result;
  }, [tokens]);

  const lineNumWidth = String(lines.length).length;
  const gutterWidth = Math.max(lineNumWidth * 9 + 16, 36);

  return (
    <div style={{ position: 'relative', ...style }}>
      {/* Code area with line numbers */}
      <pre style={{
        margin: 0,
        padding: 0,
        backgroundColor: '#1e1e2e',
        borderRadius: 'var(--radius-md)',
        border: '1px solid rgba(255,255,255,0.06)',
        fontSize: '0.8rem',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: '#cdd6f4',
        maxHeight,
        overflowY: 'auto',
        overflowX: 'auto',
        lineHeight: 1.7,
        display: 'flex',
        position: 'relative',
      }}>
        {/* Floating toolbar: copy + format toggle */}
        {(showFormatToggle || onCopy) && (
          <div style={{
            position: 'sticky',
            top: 0,
            right: 0,
            zIndex: 2,
            display: 'flex',
            gap: '4px',
            padding: '6px 8px',
            pointerEvents: 'none',
            marginLeft: 'auto',
            width: 0,
            overflow: 'visible',
            whiteSpace: 'nowrap',
            flexDirection: 'row-reverse',
          }}>
            {showFormatToggle && (
              <button
                onClick={() => setFormatted(f => !f)}
                style={{
                  pointerEvents: 'auto',
                  padding: '3px 10px', borderRadius: '4px', fontSize: '0.72rem',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backgroundColor: formatted ? 'rgba(203,166,247,0.15)' : 'rgba(24,24,37,0.85)',
                  color: formatted ? '#cba6f7' : '#6c7086',
                  cursor: 'pointer', transition: 'all 0.15s',
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  fontFamily: "'JetBrains Mono', monospace",
                  backdropFilter: 'blur(8px)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
                </svg>
                {formatted ? '已美化' : '美化 SQL'}
              </button>
            )}
            {onCopy && (
              <button
                onClick={onCopy}
                style={{
                  pointerEvents: 'auto',
                  padding: '3px 10px', borderRadius: '4px', fontSize: '0.72rem',
                  border: '1px solid rgba(255,255,255,0.1)',
                  backgroundColor: copied ? 'rgba(166,227,161,0.15)' : 'rgba(24,24,37,0.85)',
                  color: copied ? '#a6e3a1' : '#6c7086',
                  cursor: 'pointer', transition: 'all 0.15s',
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  fontFamily: "'JetBrains Mono', monospace",
                  backdropFilter: 'blur(8px)',
                }}
              >
                {copied ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                )}
                {copied ? '已复制' : '复制'}
              </button>
            )}
          </div>
        )}
        {/* Line numbers gutter */}
        {showLineNumbers && (
          <div
            aria-hidden="true"
            style={{
              position: 'sticky',
              left: 0,
              zIndex: 1,
              width: `${gutterWidth}px`,
              minWidth: `${gutterWidth}px`,
              paddingTop: '14px',
              paddingBottom: '14px',
              backgroundColor: '#181825',
              borderRight: '1px solid rgba(255,255,255,0.06)',
              textAlign: 'right',
              color: '#45475a',
              userSelect: 'none',
              fontSize: '0.72rem',
              flexShrink: 0,
            }}
          >
            {lineTokens.map((_, i) => (
              <div key={i} style={{ paddingRight: '10px', height: `${1.7 * 0.8}rem` }}>
                {i + 1}
              </div>
            ))}
          </div>
        )}

        {/* Code content */}
        <code style={{
          display: 'block',
          padding: '14px 16px',
          whiteSpace: 'pre',
          flex: 1,
          minWidth: 0,
        }}>
          {lineTokens.map((lineToks, lineIdx) => (
            <div key={lineIdx} style={{ height: `${1.7 * 0.8}rem`, display: 'flex', alignItems: 'center' }}>
              {lineToks.length === 0 ? '\u00A0' : lineToks.map((token, i) => (
                <span key={i} style={getTokenStyle(token.type)}>
                  {token.value}
                </span>
              ))}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

// ==================== SQL Formatter ====================

/**
 * Format SQL to match the reference style:
 * - CREATE / ALTER / DROP statements on their own line
 * - COMMENT, DISTRIBUTED, PARTITION BY, REFRESH, PROPERTIES, AS each on new line (indent 0)
 * - PROPERTIES values indented 4 spaces, one per line
 * - SELECT columns each on a new line, indented 4 spaces
 * - FROM, LEFT/RIGHT/INNER JOIN at base indent
 * - Subqueries indent deeper inside parentheses
 * - Inline comments (--) preserved on same line
 * - Original case preserved
 */
function formatSql(raw: string): string {
  if (!raw || !raw.trim()) return raw;

  const tokens = tokenizeForFormat(raw);
  const out: string[] = [];
  const INDENT = '    '; // 4 spaces to match reference
  let depth = 0;         // paren nesting depth
  let selectDepth = -1;  // paren depth at which current SELECT lives
  let inSelect = false;  // are we inside a SELECT column list?
  let inProperties = false;
  let propertiesParenDepth = -1;
  let lineStart = true;
  let parenCount = 0;    // raw paren nesting count
  let beforeAs = true;   // true until we see AS (before query body)
  let currentLineLen = 0; // track current line length
  const MAX_LINE = 100;  // max line width before forcing breaks

  function newline() {
    out.push('\n');
    const indent = INDENT.repeat(depth);
    out.push(indent);
    lineStart = true;
    currentLineLen = indent.length;
  }

  function space() {
    if (out.length > 0) {
      const last = out[out.length - 1];
      if (last && !last.endsWith(' ') && !last.endsWith('\n')) {
        out.push(' ');
        currentLineLen++;
      }
    }
  }

  function emit(s: string) {
    out.push(s);
    // update line length (only count chars after last newline in s)
    const nlIdx = s.lastIndexOf('\n');
    if (nlIdx >= 0) {
      currentLineLen = s.length - nlIdx - 1;
    } else {
      currentLineLen += s.length;
    }
    lineStart = false;
  }

  function peekUpper(offset: number): string {
    for (let k = offset; k < tokens.length; k++) {
      if (!/^\s+$/.test(tokens[k])) return tokens[k].toUpperCase();
    }
    return '';
  }

  function prevUpper(): string {
    // find the last non-whitespace token we emitted
    for (let k = out.length - 1; k >= 0; k--) {
      const s = out[k].trim();
      if (s) {
        // get last word
        const words = s.split(/\s+/);
        return words[words.length - 1].toUpperCase();
      }
    }
    return '';
  }

  // Top-level clause keywords that should start a new line at current depth
  const TOP_CLAUSES = new Set([
    'COMMENT', 'DISTRIBUTED', 'REFRESH', 'PROPERTIES', 'AS',
  ]);

  // Sub-clause keywords that start new line at current depth
  const SUB_CLAUSES = new Set([
    'SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET',
    'UNION', 'EXCEPT', 'INTERSECT',
  ]);

  // These start new line but at same depth as FROM
  const JOIN_KEYWORDS = new Set([
    'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS',
  ]);

  // Compound: these follow a preceding keyword on same line
  const COMPOUND_FOLLOWERS = new Set([
    'BY', 'JOIN', 'OUTER', 'ALL', 'DISTINCT',
    'ASYNC', 'SYNC', 'MANUAL',
    'MATERIALIZED',
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const upper = tok.toUpperCase();
    const next = peekUpper(i + 1);

    // ---- Whitespace: collapse to single space ----
    if (/^\s+$/.test(tok)) {
      if (!lineStart) space();
      continue;
    }

    // ---- Inline comments: emit on same line ----
    if (tok.startsWith('--')) {
      space();
      emit(tok);
      continue;
    }
    if (tok.startsWith('/*')) {
      space();
      emit(tok);
      continue;
    }

    // ---- PROPERTIES block handling ----
    if (upper === 'PROPERTIES') {
      newline();
      emit(tok);
      inProperties = true;
      continue;
    }

    if (inProperties && tok === '(') {
      space();
      emit('(');
      propertiesParenDepth = depth;
      depth++;
      newline();
      continue;
    }

    if (inProperties && tok === ')' && propertiesParenDepth >= 0) {
      depth = propertiesParenDepth;
      newline();
      emit(')');
      inProperties = false;
      propertiesParenDepth = -1;
      continue;
    }

    if (inProperties && tok === ',') {
      emit(',');
      newline();
      continue;
    }

    // ---- PARTITION BY (compound on same line as previous) ----
    if (upper === 'PARTITION') {
      newline();
      emit(tok);
      continue;
    }

    // ---- Compound followers: stay on current line ----
    if (COMPOUND_FOLLOWERS.has(upper)) {
      const prev = prevUpper();
      // GROUP BY, ORDER BY, PARTITION BY, DISTRIBUTED BY
      if (upper === 'BY' && ['GROUP', 'ORDER', 'PARTITION', 'DISTRIBUTED'].includes(prev)) {
        space(); emit(tok); continue;
      }
      if (upper === 'JOIN' && JOIN_KEYWORDS.has(prev)) {
        space(); emit(tok); continue;
      }
      if (upper === 'OUTER' && JOIN_KEYWORDS.has(prev)) {
        space(); emit(tok); continue;
      }
      if (upper === 'ALL' && prev === 'UNION') {
        space(); emit(tok); continue;
      }
      if (upper === 'DISTINCT' && prev === 'SELECT') {
        space(); emit(tok); continue;
      }
      if (['ASYNC', 'SYNC', 'MANUAL'].includes(upper) && prev === 'REFRESH') {
        space(); emit(tok); continue;
      }
      if (upper === 'MATERIALIZED' && prev === 'CREATE') {
        space(); emit(tok); continue;
      }
      // fall through if not compound
    }

    // ---- Top-level clauses at depth 0 (or base subquery depth) ----
    if (TOP_CLAUSES.has(upper) && !inProperties) {
      // COMMENT: only treat as top-level clause when not inside parens (column defs)
      if (upper === 'COMMENT' && parenCount > 0) {
        space(); emit(tok); continue;
      }
      if (upper === 'AS') {
        if (next === 'SELECT' || next === '(') {
          beforeAs = false;
          newline();
          emit(tok);
          continue;
        }
        space(); emit(tok); continue;
      }
      newline();
      emit(tok);
      continue;
    }

    // ---- GROUP, ORDER: start new line ----
    if ((upper === 'GROUP' || upper === 'ORDER') && next === 'BY') {
      newline();
      emit(tok);
      continue;
    }

    // ---- Sub-clauses (SELECT, FROM, WHERE, etc.) ----
    if (SUB_CLAUSES.has(upper)) {
      if (upper === 'SELECT') {
        newline();
        emit(tok);
        inSelect = true;
        selectDepth = depth;
        continue;
      }
      if (upper === 'FROM' || upper === 'WHERE' || upper === 'HAVING' || upper === 'LIMIT' || upper === 'OFFSET') {
        inSelect = false;
        newline();
        emit(tok);
        continue;
      }
      // UNION, EXCEPT, INTERSECT
      newline();
      emit(tok);
      continue;
    }

    // ---- JOIN keywords (LEFT, RIGHT, etc.) ----
    if (JOIN_KEYWORDS.has(upper) && next === 'JOIN') {
      inSelect = false;
      newline();
      emit(tok);
      continue;
    }
    // bare JOIN
    if (upper === 'JOIN' && !JOIN_KEYWORDS.has(prevUpper())) {
      inSelect = false;
      newline();
      emit(tok);
      continue;
    }

    // ---- AND / OR in WHERE clause ----
    if ((upper === 'AND' || upper === 'OR') && !inSelect && depth === selectDepth) {
      newline();
      emit(INDENT + tok);
      continue;
    }

    // ---- Comma handling ----
    if (tok === ',') {
      emit(',');
      // SELECT columns: always break at comma
      if (inSelect && depth === selectDepth) {
        newline();
        emit(INDENT);
        continue;
      }
      // CREATE column definitions (before AS, inside parens): break at comma
      if (beforeAs && parenCount > 0 && !inProperties) {
        newline();
        emit(INDENT);
        continue;
      }
      // General: break if line is getting too long
      if (currentLineLen > MAX_LINE) {
        newline();
        emit(INDENT);
        continue;
      }
      continue;
    }

    // ---- Opening paren ----
    if (tok === '(') {
      parenCount++;
      // If next is SELECT → subquery, increase depth
      if (next === 'SELECT') {
        space();
        emit('(');
        depth++;
        continue;
      }
      // else function call paren or PROPERTIES — stay inline
      if (!lineStart && out.length > 0) {
        const last = out[out.length - 1];
        if (last && /[a-zA-Z0-9_`]$/.test(last.trim())) {
          // no space before function call paren
        } else {
          space();
        }
      }
      emit('(');
      continue;
    }

    // ---- Closing paren ----
    if (tok === ')') {
      if (parenCount > 0) parenCount--;
      if (depth > 0) {
        depth--;
        if (inSelect && depth < selectDepth) {
          inSelect = false;
        }
      }
      emit(')');
      continue;
    }

    // ---- Semicolon ----
    if (tok === ';') {
      emit(';');
      newline();
      depth = 0;
      inSelect = false;
      selectDepth = -1;
      beforeAs = true;
      continue;
    }

    // ---- ON (after JOIN) ----
    if (upper === 'ON' && !inSelect) {
      space();
      emit(tok);
      continue;
    }

    // ---- Regular token ----
    if (!lineStart) {
      space();
    }
    emit(tok);
  }

  let formatted = out.join('');

  // Post-processing cleanup
  formatted = formatted
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return formatted;
}

function tokenizeForFormat(sql: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < sql.length) {
    // Whitespace
    if (/\s/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /\s/.test(sql[j])) j++;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // String literals
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let j = i + 1;
      while (j < sql.length && sql[j] !== quote) {
        if (sql[j] === '\\') j++;
        j++;
      }
      j++;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // Backtick identifiers
    if (sql[i] === '`') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '`') j++;
      j++;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // Inline comments --
    if (sql[i] === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
      let j = i;
      while (j < sql.length && sql[j] !== '\n') j++;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // Block comments /* */
    if (sql[i] === '/' && i + 1 < sql.length && sql[i + 1] === '*') {
      let j = i + 2;
      while (j < sql.length - 1 && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      j += 2;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // Punctuation
    if ('(),;.'.includes(sql[i])) {
      tokens.push(sql[i]);
      i++;
      continue;
    }

    // Operators
    if ('=<>!+-*/%'.includes(sql[i])) {
      let j = i;
      while (j < sql.length && '=<>!+-*/%'.includes(sql[j])) j++;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // Words
    if (/[a-zA-Z_]/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) j++;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // Numbers
    if (/\d/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[\d.]/.test(sql[j])) j++;
      tokens.push(sql.slice(i, j));
      i = j;
      continue;
    }

    // Catch-all
    tokens.push(sql[i]);
    i++;
  }

  return tokens;
}

// ==================== Syntax Highlighter ====================

type TokenType = 'keyword' | 'string' | 'number' | 'comment' | 'operator' | 'punctuation' | 'identifier' | 'whitespace';

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    // Whitespace
    if (/\s/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /\s/.test(sql[j])) j++;
      tokens.push({ type: 'whitespace', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Single-line comment --
    if (sql[i] === '-' && sql[i + 1] === '-') {
      let j = i;
      while (j < sql.length && sql[j] !== '\n') j++;
      tokens.push({ type: 'comment', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Block comment /* */
    if (sql[i] === '/' && sql[i + 1] === '*') {
      let j = i + 2;
      while (j < sql.length - 1 && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      j += 2;
      tokens.push({ type: 'comment', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // String (single or double quotes)
    if (sql[i] === '"' || sql[i] === "'") {
      const quote = sql[i];
      let j = i + 1;
      while (j < sql.length && sql[j] !== quote) {
        if (sql[j] === '\\') j++;
        j++;
      }
      j++; // closing quote
      tokens.push({ type: 'string', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Backtick identifiers
    if (sql[i] === '`') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '`') j++;
      j++;
      tokens.push({ type: 'identifier', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/\d/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[\d.]/.test(sql[j])) j++;
      tokens.push({ type: 'number', value: sql.slice(i, j) });
      i = j;
      continue;
    }

    // Words (keywords or identifiers)
    if (/[a-zA-Z_]/.test(sql[i])) {
      let j = i;
      while (j < sql.length && /[a-zA-Z0-9_]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const type = SQL_KEYWORDS.has(word.toUpperCase()) ? 'keyword' : 'identifier';
      tokens.push({ type, value: word });
      i = j;
      continue;
    }

    // Operators & punctuation
    if ('=<>!+-*/%'.includes(sql[i])) {
      tokens.push({ type: 'operator', value: sql[i] });
      i++;
      continue;
    }

    if ('(),;.'.includes(sql[i])) {
      tokens.push({ type: 'punctuation', value: sql[i] });
      i++;
      continue;
    }

    // Catch-all
    tokens.push({ type: 'identifier', value: sql[i] });
    i++;
  }

  return tokens;
}

function getTokenStyle(type: TokenType): React.CSSProperties {
  switch (type) {
    case 'keyword':
      return { color: '#cba6f7', fontWeight: 600 }; // purple
    case 'string':
      return { color: '#a6e3a1' }; // green
    case 'number':
      return { color: '#fab387' }; // orange
    case 'comment':
      return { color: '#6c7086', fontStyle: 'italic' }; // gray
    case 'operator':
      return { color: '#89dceb' }; // cyan
    case 'punctuation':
      return { color: '#9399b2' }; // gray-blue
    case 'identifier':
      return { color: '#cdd6f4' }; // default light
    default:
      return {};
  }
}
