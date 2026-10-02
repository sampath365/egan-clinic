import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  loading?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, loading }: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="card card-pad">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded-md bg-ink-100" />)}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="card card-pad text-center text-sm text-ink-500">{empty ?? 'Nothing to show yet.'}</div>;
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn('px-4 py-3', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-brand-50/40')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="space-y-2 md:hidden">
        {rows.map((row) => {
          const isAction = (c: Column<T>) => !c.header && c.align === 'right';
          const detailCols = columns.filter((c) => !isAction(c));
          const actionCols = columns.filter(isAction);
          return (
            <div
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('card card-pad', onRowClick && 'cursor-pointer active:bg-ink-50')}
            >
              <dl className="space-y-2">
                {detailCols.map((c) => (
                  <div key={c.key} className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-ink-400">{c.header}</dt>
                    <dd className="min-w-0 text-right text-sm text-ink-800">{c.render(row)}</dd>
                  </div>
                ))}
              </dl>
              {actionCols.length > 0 && (
                <div
                  className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  {actionCols.map((c) => <div key={c.key}>{c.render(row)}</div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
