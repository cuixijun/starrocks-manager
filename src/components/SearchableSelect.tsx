'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';

export interface SearchableSelectOption {
  label: string;
  value: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  /** Min items before search input is shown (default: 6) */
  searchThreshold?: number;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '请选择...',
  searchPlaceholder = '搜索...',
  disabled = false,
  searchThreshold = 6,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute position when opening
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on scroll of any ancestor (reposition would be complex)
  useEffect(() => {
    if (!open) return;
    function handler() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    // Listen to scroll on capture phase to catch modal scroll
    document.addEventListener('scroll', handler, true);
    return () => document.removeEventListener('scroll', handler, true);
  }, [open]);

  // Focus search input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const filtered = options.filter(opt =>
    opt.label.toLowerCase().includes(query.toLowerCase()) ||
    opt.value.toLowerCase().includes(query.toLowerCase())
  );

  const selectedLabel = options.find(o => o.value === value)?.label || '';
  const showSearch = options.length >= searchThreshold;

  const handleSelect = useCallback((val: string) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  }, [onChange]);

  const dropdown = open ? (
    <div
      ref={dropdownRef}
      className="ss-dropdown"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 10000,
      }}
    >
      {showSearch && (
        <div className="ss-search-wrap">
          <Search size={13} className="ss-search-icon" />
          <input
            ref={inputRef}
            className="ss-search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
          />
          {query && (
            <button className="ss-clear" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="ss-list">
        {filtered.length === 0 ? (
          <div className="ss-empty">无匹配项</div>
        ) : (
          filtered.map(opt => (
            <div
              key={opt.value}
              className={`ss-option${opt.value === value ? ' ss-selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              <span className="ss-option-label">{opt.label}</span>
              {opt.value === value && <Check size={14} className="ss-check" />}
            </div>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="ss-container">
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        className={`ss-trigger${open ? ' ss-open' : ''}${disabled ? ' ss-disabled' : ''}`}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span className={`ss-value${!value ? ' ss-placeholder' : ''}`}>
          {value ? selectedLabel : placeholder}
        </span>
        <ChevronDown size={14} className={`ss-chevron${open ? ' ss-rotated' : ''}`} />
      </button>

      {/* Portal dropdown to body so it's not clipped by modal overflow */}
      {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  );
}
