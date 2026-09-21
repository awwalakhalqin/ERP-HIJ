import React from 'react';
import { cn } from '../../lib/utils';

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** Page-level buttons. Put the primary action last. */
  actions?: React.ReactNode;
  className?: string;
}

/** The one header every module page opens with. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, className }) => (
  <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
    <div className="min-w-0">
      <h1 className="text-2xl font-bold tracking-tight text-foreground text-balance">{title}</h1>
      {description && (
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p>
      )}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
  </div>
);
