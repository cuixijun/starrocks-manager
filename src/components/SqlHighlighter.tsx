'use client';

import React from 'react';

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
]);

interface SqlHighlighterProps {
  sql: string;
  style?: React.CSSProperties;
}

export default function SqlHighlighter({ sql, style }: SqlHighlighterProps) {
  const tokens = tokenize(sql);

  return (
    <pre style={{
      padding: '14px',
      backgroundColor: '#1e1e2e',
      borderRadius: 'var(--radius-md)',
      border: '1px solid rgba(255,255,255,0.06)',
      fontSize: '0.8rem',
      whiteSpace: 'pre-wrap',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      color: '#cdd6f4',
      maxHeight: '400px',
      overflowY: 'auto',
      lineHeight: 1.7,
      margin: 0,
      ...style,
    }}>
      {tokens.map((token, i) => (
        <span key={i} style={getTokenStyle(token.type)}>
          {token.value}
        </span>
      ))}
    </pre>
  );
}

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
