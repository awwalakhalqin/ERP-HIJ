import React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'teal';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variantClasses = {
      default: 'bg-brand-teal text-[#000000] hover:bg-[#249ea2] shadow-xs active:scale-[0.98] font-bold',
      destructive: 'bg-brand-red text-white hover:bg-brand-red-hover shadow-2xs active:scale-[0.98]',
      outline: 'border border-border bg-white text-foreground hover:bg-muted hover:border-brand-teal/60 shadow-2xs active:scale-[0.98]',
      secondary: 'bg-brand-teal-dark text-white hover:bg-[#0e5662] shadow-2xs active:scale-[0.98]',
      ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
      link: 'text-brand-teal-dark underline-offset-4 hover:underline p-0 h-auto',
      teal: 'bg-brand-teal text-[#000000] hover:bg-[#249ea2] shadow-xs active:scale-[0.98] font-bold'
    };

    const sizeClasses = {
      default: 'h-10 px-4 py-2 text-sm font-semibold rounded-lg',
      sm: 'h-9 px-3 text-sm font-semibold rounded-lg',
      lg: 'h-11 px-6 text-base font-semibold rounded-lg',
      icon: 'h-9 w-9 rounded-lg p-0 flex items-center justify-center'
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none',
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
