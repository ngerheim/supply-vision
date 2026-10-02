'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

function Table({ className, horizontalControls=false, ...props }: React.ComponentProps<'table'> & {horizontalControls?:boolean}) {
  const scrollRef=React.useRef<HTMLDivElement>(null);
  const [scroll,setScroll]=React.useState({left:0,max:0});
  React.useEffect(()=>{
    if(!horizontalControls)return;
    const node=scrollRef.current;
    if(!node)return;
    const update=()=>setScroll({left:node.scrollLeft,max:Math.max(0,node.scrollWidth-node.clientWidth)});
    const wheel=(event:WheelEvent)=>{if(event.shiftKey&&event.deltaY){event.preventDefault();node.scrollLeft+=event.deltaY;}};
    const observer=new ResizeObserver(update);observer.observe(node);
    if(node.firstElementChild)observer.observe(node.firstElementChild);
    node.addEventListener('scroll',update);node.addEventListener('wheel',wheel,{passive:false});update();
    return()=>{observer.disconnect();node.removeEventListener('scroll',update);node.removeEventListener('wheel',wheel);};
  },[horizontalControls]);
  return (
    <div>
    {horizontalControls&&scroll.max>0&&<div className="sticky top-0 z-20 bg-card px-3 py-1"><input aria-label="Rolar tabela horizontalmente" type="range" className="w-full" min={0} max={scroll.max} value={scroll.left} onChange={event=>{if(scrollRef.current)scrollRef.current.scrollLeft=Number(event.target.value);}}/></div>}
    <div
      ref={scrollRef}
      data-slot="table-container"
      className={horizontalControls?'relative max-h-[60vh] w-full overflow-auto':'relative w-full overflow-x-auto'}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors has-aria-expanded:bg-muted/50',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
